"""
Router Chat nội bộ — nhắn tin 1-1 và nhóm giữa người dùng trong CÙNG công ty.
Độc lập với module Thông báo. Guard chính: người dùng chỉ thao tác được trên
phòng (conversation) mà mình là THÀNH VIÊN (kiểm qua ConversationMember).

Mọi truy vấn lọc theo company_id để bảo đảm cô lập đa người dùng (tenant).
Mô hình poll ~8s ở frontend (không WebSocket) — giống các module hiện có.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db, vn_now
from app.deps import get_current_user
from app.models import (
    ChatMessage, Conversation, ConversationMember, ConversationType, MessageReaction,
    Project, User, UserRole, project_members,
)
from app.schemas import (
    ChatMemberOut, ConversationAddMembers, ConversationCreate, ConversationOut,
    ConversationRename, MessageCreate, MessageOut, ReactionAgg, ReactionCreate,
)

router = APIRouter(prefix="/chat", tags=["Chat"])


def _direct_key(a: int, b: int) -> str:
    """Khóa dedup phòng 1-1 = 'min:max' của 2 user id."""
    return f"{min(a, b)}:{max(a, b)}"


def _member_ids(db: Session, conversation_id: int) -> list[int]:
    return [
        m.user_id
        for m in db.query(ConversationMember)
        .filter(ConversationMember.conversation_id == conversation_id)
        .all()
    ]


def _require_membership(db: Session, conv_id: int, current: User) -> Conversation:
    """Trả về phòng nếu current là thành viên & cùng công ty, ngược lại 404."""
    conv = db.get(Conversation, conv_id)
    if not conv or conv.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy cuộc trò chuyện.")
    is_member = (
        db.query(ConversationMember)
        .filter(
            ConversationMember.conversation_id == conv_id,
            ConversationMember.user_id == current.id,
        )
        .first()
    )
    if not is_member:
        raise HTTPException(404, "Không tìm thấy cuộc trò chuyện.")
    return conv


def _build_out(db: Session, conv: Conversation, current: User) -> ConversationOut:
    """Bơm thủ công members / last_message / unread cho 1 phòng (không map thẳng ORM)."""
    members = (
        db.query(ConversationMember)
        .filter(ConversationMember.conversation_id == conv.id)
        .all()
    )
    umap = {
        u.id: u
        for u in db.query(User)
        .filter(User.id.in_([m.user_id for m in members] or [0]))
        .all()
    }
    member_out = [
        ChatMemberOut(
            user_id=m.user_id,
            user_name=umap[m.user_id].full_name if m.user_id in umap else None,
        )
        for m in members
    ]

    last = (
        db.query(ChatMessage)
        .filter(ChatMessage.conversation_id == conv.id)
        .order_by(ChatMessage.id.desc())
        .first()
    )

    me = next((m for m in members if m.user_id == current.id), None)
    last_read = (me.last_read_message_id or 0) if me else 0
    unread = (
        db.query(func.count(ChatMessage.id))
        .filter(
            ChatMessage.conversation_id == conv.id,
            ChatMessage.id > last_read,
            ChatMessage.sender_id != current.id,   # tin của chính mình không tính chưa đọc
        )
        .scalar()
    ) or 0

    return ConversationOut(
        id=conv.id,
        type=conv.type,
        title=conv.title,
        project_id=conv.project_id,
        members=member_out,
        last_message=last.body if last else None,
        last_message_at=conv.last_message_at,
        unread=int(unread),
        created_at=conv.created_at,
    )


def _agg_reactions(rows: list[MessageReaction], current_id: int) -> list[ReactionAgg]:
    """Gộp list MessageReaction của MỘT tin -> list ReactionAgg (emoji, count, mine)."""
    counts: dict[str, int] = {}
    mine: set[str] = set()
    for r in rows:
        counts[r.emoji] = counts.get(r.emoji, 0) + 1
        if r.user_id == current_id:
            mine.add(r.emoji)
    return [
        ReactionAgg(emoji=e, count=c, mine=(e in mine))
        for e, c in counts.items()
    ]


def _message_out(db: Session, msg: ChatMessage, current: User) -> MessageOut:
    """Build 1 MessageOut kèm reactions của chính tin đó."""
    rx = (
        db.query(MessageReaction)
        .filter(MessageReaction.message_id == msg.id)
        .all()
    )
    return MessageOut(
        id=msg.id,
        conversation_id=msg.conversation_id,
        sender_id=msg.sender_id,
        sender_name=msg.sender_name,
        body=msg.body,
        created_at=msg.created_at,
        reactions=_agg_reactions(rx, current.id),
    )


def _messages_out(db: Session, msgs: list[ChatMessage], current: User) -> list[MessageOut]:
    """Build nhiều MessageOut — 1 query duy nhất lấy hết reactions (không N+1)."""
    ids = [m.id for m in msgs]
    by_msg: dict[int, list[MessageReaction]] = {}
    if ids:
        for r in (
            db.query(MessageReaction)
            .filter(MessageReaction.message_id.in_(ids))
            .all()
        ):
            by_msg.setdefault(r.message_id, []).append(r)
    return [
        MessageOut(
            id=m.id,
            conversation_id=m.conversation_id,
            sender_id=m.sender_id,
            sender_name=m.sender_name,
            body=m.body,
            created_at=m.created_at,
            reactions=_agg_reactions(by_msg.get(m.id, []), current.id),
        )
        for m in msgs
    ]


@router.get("/conversations", response_model=list[ConversationOut])
def list_conversations(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    """Danh sách phòng của current user, sort theo tin mới nhất (last_message_at desc)."""
    my = (
        db.query(ConversationMember.conversation_id)
        .filter(ConversationMember.user_id == current.id)
        .subquery()
    )
    convs = (
        db.query(Conversation)
        .filter(
            Conversation.company_id == current.company_id,
            Conversation.id.in_(my),
        )
        .order_by(
            Conversation.last_message_at.desc().nullslast(),
            Conversation.id.desc(),
        )
        .all()
    )
    return [_build_out(db, c, current) for c in convs]


@router.post("/conversations", response_model=ConversationOut, status_code=201)
def create_conversation(
    payload: ConversationCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """
    Tạo/lấy phòng.
    - DIRECT: nếu đã tồn tại (theo direct_key) -> trả phòng cũ (idempotent).
    - GROUP: bắt buộc title + >=2 member; tự thêm current làm member.
    Validate mọi member cùng company_id.
    """
    ctype = (payload.type or "DIRECT").upper()
    if ctype not in (ConversationType.DIRECT.value, ConversationType.GROUP.value):
        raise HTTPException(400, "Loại cuộc trò chuyện không hợp lệ.")

    # Lọc bỏ trùng & bỏ chính mình khỏi danh sách người kia.
    other_ids = [uid for uid in dict.fromkeys(payload.member_ids) if uid != current.id]
    if not other_ids:
        raise HTTPException(400, "Chưa chọn người trò chuyện.")

    # Validate tất cả người kia tồn tại & cùng công ty.
    others = (
        db.query(User)
        .filter(User.id.in_(other_ids), User.company_id == current.company_id)
        .all()
    )
    if len(others) != len(other_ids):
        raise HTTPException(400, "Có người nhận không hợp lệ.")

    if ctype == ConversationType.DIRECT.value:
        if len(other_ids) != 1:
            raise HTTPException(400, "Phòng 1-1 chỉ gồm đúng 1 người kia.")
        key = _direct_key(current.id, other_ids[0])
        existing = (
            db.query(Conversation)
            .filter(
                Conversation.company_id == current.company_id,
                Conversation.direct_key == key,
            )
            .first()
        )
        if existing:
            return _build_out(db, existing, current)

        conv = Conversation(
            company_id=current.company_id,
            type=ConversationType.DIRECT,
            title=None,
            created_by_id=current.id,
            direct_key=key,
        )
        member_ids = [current.id, other_ids[0]]
    else:  # GROUP
        title = (payload.title or "").strip()
        if not title:
            raise HTTPException(400, "Nhóm cần có tên.")
        if len(other_ids) < 2:
            raise HTTPException(400, "Nhóm cần ít nhất 2 người ngoài bạn.")
        conv = Conversation(
            company_id=current.company_id,
            type=ConversationType.GROUP,
            title=title,
            created_by_id=current.id,
            direct_key=None,
        )
        member_ids = [current.id, *other_ids]

    db.add(conv)
    db.flush()   # có conv.id để gắn member
    for uid in dict.fromkeys(member_ids):
        db.add(ConversationMember(
            company_id=current.company_id,
            conversation_id=conv.id,
            user_id=uid,
            last_read_message_id=0,
        ))
    db.commit()
    db.refresh(conv)
    return _build_out(db, conv, current)


def _project_member_ids(db: Session, project: Project) -> list[int]:
    """Danh sách user_id thuộc dự án = thành viên + người chủ trì (dedup)."""
    ids = [
        row[0]
        for row in db.query(project_members.c.user_id)
        .filter(project_members.c.project_id == project.id)
        .all()
    ]
    if project.lead_id:
        ids.append(project.lead_id)
    return list(dict.fromkeys(ids))


@router.get("/project/{project_id}", response_model=ConversationOut)
def project_conversation(
    project_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """
    Get-or-create NHÓM CHAT của một dự án.
    - Chỉ người liên quan dự án (Director/Admin, người chủ trì, hoặc thành viên) mới vào.
    - Nhóm dùng lại theo project_id (không tạo trùng); đồng bộ thành viên nhóm = thành
      viên dự án + người chủ trì mỗi lần gọi (kết nạp người mới, KHÔNG tự loại bỏ ai để
      giữ lịch sử — chỉ thêm cho đơn giản & an toàn).
    """
    project = db.get(Project, project_id)
    if not project or project.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy dự án.")

    is_director = current.role in (UserRole.DIRECTOR, UserRole.ADMIN)
    pmember_ids = _project_member_ids(db, project)
    if not is_director and current.id not in pmember_ids:
        raise HTTPException(403, "Bạn không thuộc dự án này.")

    # Nhóm chat của dự án (get-or-create theo project_id).
    conv = (
        db.query(Conversation)
        .filter(
            Conversation.company_id == current.company_id,
            Conversation.project_id == project_id,
        )
        .first()
    )
    if not conv:
        conv = Conversation(
            company_id=current.company_id,
            type=ConversationType.GROUP,
            title=f"Dự án: {project.name}",
            created_by_id=current.id,
            direct_key=None,
            project_id=project_id,
        )
        db.add(conv)
        db.flush()

    # Đồng bộ thành viên: thêm mọi người thuộc dự án + Giám đốc đang mở (nếu chưa có).
    want_ids = list(dict.fromkeys([*pmember_ids, current.id]))
    existing_ids = {
        m.user_id
        for m in db.query(ConversationMember)
        .filter(ConversationMember.conversation_id == conv.id)
        .all()
    }
    for uid in want_ids:
        if uid not in existing_ids:
            db.add(ConversationMember(
                company_id=current.company_id,
                conversation_id=conv.id,
                user_id=uid,
                last_read_message_id=0,
            ))
    db.commit()
    db.refresh(conv)
    return _build_out(db, conv, current)


@router.get("/conversations/{conv_id}", response_model=ConversationOut)
def get_conversation(
    conv_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)
):
    conv = _require_membership(db, conv_id, current)
    return _build_out(db, conv, current)


@router.get("/conversations/{conv_id}/messages", response_model=list[MessageOut])
def list_messages(
    conv_id: int,
    before: int | None = None,
    limit: int = 30,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Phân trang lùi theo id < before; trả theo thứ tự TĂNG DẦN để FE render."""
    _require_membership(db, conv_id, current)
    limit = max(1, min(limit, 100))
    q = db.query(ChatMessage).filter(ChatMessage.conversation_id == conv_id)
    if before:
        q = q.filter(ChatMessage.id < before)
    rows = q.order_by(ChatMessage.id.desc()).limit(limit).all()
    rows.reverse()   # trả cũ -> mới cho FE
    return _messages_out(db, rows, current)


@router.post("/conversations/{conv_id}/messages", response_model=MessageOut, status_code=201)
def send_message(
    conv_id: int,
    payload: MessageCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Thêm tin; cập nhật last_message_at + con trỏ đã đọc của người gửi."""
    conv = _require_membership(db, conv_id, current)
    body = payload.body.strip()
    if not body:
        raise HTTPException(400, "Nội dung tin nhắn trống.")
    msg = ChatMessage(
        company_id=current.company_id,
        conversation_id=conv_id,
        sender_id=current.id,
        body=body,
    )
    db.add(msg)
    db.flush()
    conv.last_message_at = vn_now()
    # người gửi đương nhiên đã đọc tin mình vừa gửi
    me = (
        db.query(ConversationMember)
        .filter(
            ConversationMember.conversation_id == conv_id,
            ConversationMember.user_id == current.id,
        )
        .first()
    )
    if me:
        me.last_read_message_id = msg.id
    db.commit()
    db.refresh(msg)
    return _message_out(db, msg, current)


@router.post("/conversations/{conv_id}/read", status_code=204)
def mark_read(
    conv_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)
):
    """Đặt con trỏ đã đọc của current = id tin mới nhất trong phòng."""
    _require_membership(db, conv_id, current)
    last = (
        db.query(func.max(ChatMessage.id))
        .filter(ChatMessage.conversation_id == conv_id)
        .scalar()
    )
    me = (
        db.query(ConversationMember)
        .filter(
            ConversationMember.conversation_id == conv_id,
            ConversationMember.user_id == current.id,
        )
        .first()
    )
    if me and last:
        me.last_read_message_id = last
        db.commit()
    return Response(status_code=204)


@router.get("/unread-count")
def unread_count(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    """Tổng số tin chưa đọc trên mọi phòng của current — cho badge FAB."""
    members = (
        db.query(ConversationMember)
        .filter(ConversationMember.user_id == current.id)
        .all()
    )
    total = 0
    for m in members:
        n = (
            db.query(func.count(ChatMessage.id))
            .filter(
                ChatMessage.conversation_id == m.conversation_id,
                ChatMessage.id > (m.last_read_message_id or 0),
                ChatMessage.sender_id != current.id,
            )
            .scalar()
        ) or 0
        total += int(n)
    return {"count": total}


# --------------------------------------------------------------------------
# CẢM XÚC (emoji) trên tin nhắn — mỗi người 1 cảm xúc / 1 tin (react lại = thay).
# --------------------------------------------------------------------------
def _load_message(db: Session, message_id: int, current: User) -> ChatMessage:
    """Lấy tin (404 nếu không tồn tại / khác công ty)."""
    msg = db.get(ChatMessage, message_id)
    if not msg or msg.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy tin nhắn.")
    return msg


@router.put("/messages/{message_id}/reaction", response_model=MessageOut)
def react_message(
    message_id: int,
    payload: ReactionCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Upsert cảm xúc của current cho tin: đã thả -> đổi emoji, chưa -> thêm."""
    msg = _load_message(db, message_id, current)
    _require_membership(db, msg.conversation_id, current)
    emoji = (payload.emoji or "").strip()
    if not (1 <= len(emoji) <= 16):
        raise HTTPException(400, "Cảm xúc không hợp lệ.")
    existing = (
        db.query(MessageReaction)
        .filter(
            MessageReaction.message_id == message_id,
            MessageReaction.user_id == current.id,
        )
        .first()
    )
    if existing:
        existing.emoji = emoji
    else:
        db.add(MessageReaction(
            company_id=current.company_id,
            message_id=message_id,
            user_id=current.id,
            emoji=emoji,
        ))
    db.commit()
    return _message_out(db, msg, current)


@router.delete("/messages/{message_id}/reaction", response_model=MessageOut)
def unreact_message(
    message_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Gỡ cảm xúc của current khỏi tin (nếu có)."""
    msg = _load_message(db, message_id, current)
    _require_membership(db, msg.conversation_id, current)
    existing = (
        db.query(MessageReaction)
        .filter(
            MessageReaction.message_id == message_id,
            MessageReaction.user_id == current.id,
        )
        .first()
    )
    if existing:
        db.delete(existing)
        db.commit()
    return _message_out(db, msg, current)


# --------------------------------------------------------------------------
# QUẢN LÝ NHÓM — chỉ áp dụng nhóm THƯỜNG (GROUP & project_id IS NULL).
# Phòng 1-1 và nhóm-dự-án tự đồng bộ -> không cho sửa.
# --------------------------------------------------------------------------
def _require_plain_group(conv: Conversation) -> None:
    if conv.type != ConversationType.GROUP or conv.project_id is not None:
        raise HTTPException(400, "Không sửa được nhóm này.")


@router.patch("/conversations/{conv_id}", response_model=ConversationOut)
def rename_conversation(
    conv_id: int,
    payload: ConversationRename,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Đổi tên nhóm — bất kỳ thành viên nào của nhóm."""
    conv = _require_membership(db, conv_id, current)
    _require_plain_group(conv)
    conv.title = payload.title.strip()
    db.commit()
    db.refresh(conv)
    return _build_out(db, conv, current)


@router.post("/conversations/{conv_id}/members", response_model=ConversationOut)
def add_conversation_members(
    conv_id: int,
    payload: ConversationAddMembers,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Thêm người vào nhóm — bất kỳ thành viên nào của nhóm."""
    conv = _require_membership(db, conv_id, current)
    _require_plain_group(conv)

    new_ids = [uid for uid in dict.fromkeys(payload.member_ids)]
    if new_ids:
        valid = (
            db.query(User)
            .filter(User.id.in_(new_ids), User.company_id == current.company_id)
            .all()
        )
        if len(valid) != len(new_ids):
            raise HTTPException(400, "Có người nhận không hợp lệ.")

    existing_ids = {
        m.user_id
        for m in db.query(ConversationMember)
        .filter(ConversationMember.conversation_id == conv.id)
        .all()
    }
    for uid in new_ids:
        if uid not in existing_ids:
            db.add(ConversationMember(
                company_id=current.company_id,
                conversation_id=conv.id,
                user_id=uid,
                last_read_message_id=0,
            ))
    db.commit()
    db.refresh(conv)
    return _build_out(db, conv, current)


@router.delete("/conversations/{conv_id}/members/{user_id}", status_code=204)
def remove_conversation_member(
    conv_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Rời/xoá thành viên: rời chính mình = bất kỳ thành viên; xoá người khác = chỉ người tạo."""
    conv = _require_membership(db, conv_id, current)
    _require_plain_group(conv)
    if user_id != current.id and current.id != conv.created_by_id:
        raise HTTPException(403, "Chỉ người tạo nhóm mới xoá được thành viên khác.")
    member = (
        db.query(ConversationMember)
        .filter(
            ConversationMember.conversation_id == conv.id,
            ConversationMember.user_id == user_id,
        )
        .first()
    )
    if member:
        db.delete(member)
        db.commit()
    return Response(status_code=204)
