"""Router Quản lý Hợp đồng (Contracts) — CRUD, lọc theo công ty."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import Contract, Project, User, UserRole
from app.schemas import ContractCreate, ContractOut, ContractUpdate

router = APIRouter(prefix="/contracts", tags=["Hợp đồng"])


@router.get("", response_model=list[ContractOut])
def list_contracts(
    project_id: int | None = None,
    db: Session = Depends(get_db),
    # Chỉ Quản lý/Kế toán/Giám đốc được xem giá trị hợp đồng (nhân viên không thấy tiền).
    current: User = Depends(require_roles(UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.DIRECTOR)),
):
    """Liệt kê hợp đồng; có thể lọc theo ?project_id=..."""
    q = db.query(Contract).filter(Contract.company_id == current.company_id)
    if project_id:
        q = q.filter(Contract.project_id == project_id)
    return q.order_by(Contract.created_at.desc()).all()


@router.post("", response_model=ContractOut, status_code=201)
def create_contract(
    payload: ContractCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    # Kiểm tra dự án thuộc đúng công ty trước khi gắn hợp đồng.
    project = db.get(Project, payload.project_id)
    if not project or project.company_id != current.company_id:
        raise HTTPException(400, "Dự án không hợp lệ.")
    contract = Contract(**payload.model_dump(), company_id=current.company_id)
    db.add(contract)
    db.commit()
    db.refresh(contract)
    return contract


@router.patch("/{contract_id}", response_model=ContractOut)
def update_contract(
    contract_id: int,
    payload: ContractUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    c = db.get(Contract, contract_id)
    if not c or c.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy hợp đồng.")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    db.commit()
    db.refresh(c)
    return c
