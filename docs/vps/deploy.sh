#!/bin/bash
# DOSCO ERP — deploy trên VPS. Đặt tại /opt/dosco-erp/deploy.sh (repo nằm ở /opt/dosco-erp/app).
#
# Khác bản cũ ở 3 điểm (rút từ lần deploy 30/10/2026 build hỏng rồi "kẹt"):
#   1. So với commit ĐÃ DEPLOY XONG (file current_commit) thay vì HEAD của repo.
#      Bản cũ `git pull` trước rồi mới build; build hỏng là lần sau thấy HEAD == origin
#      -> "Không có code mới" -> không bao giờ build lại. Nay chỉ ghi current_commit
#      khi đã qua health-check, nên bấm deploy lại là chạy tiếp.
#   2. Toàn bộ output ghi vào logs/deploy-<thời điểm>.log (+ deploy-latest.log).
#   3. Health-check chờ tới 60 giây mỗi dịch vụ thay vì `sleep 5` rồi curl một phát.
#
# Dùng:  ./deploy.sh            deploy nếu GitHub có commit chưa deploy
#        ./deploy.sh --force    build + restart cả frontend lẫn backend dù không có code mới
set -Eeuo pipefail

BASE_DIR="/opt/dosco-erp"
APP_DIR="$BASE_DIR/app"
BACKUP_SCRIPT="$BASE_DIR/backup_db.sh"
LOG_DIR="$BASE_DIR/logs"
CURRENT_FILE="$BASE_DIR/current_commit"
PREVIOUS_FILE="$BASE_DIR/previous_commit"
BRANCH="main"
HEALTH_TIMEOUT=60          # giây chờ mỗi dịch vụ lên
KEEP_LOG_DAYS=30

FORCE=false
[ "${1:-}" = "--force" ] && FORCE=true

# ---- Log: in ra màn hình VÀ ghi file -------------------------------------
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/deploy-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1
ln -sfn "$LOG_FILE" "$LOG_DIR/deploy-latest.log"
find "$LOG_DIR" -name 'deploy-*.log' -mtime +"$KEEP_LOG_DAYS" -delete 2>/dev/null || true

STEP="khởi động"
on_error() {
    echo
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    echo " DEPLOY FAILED tại bước: $STEP"
    echo " Log: $LOG_FILE"
    echo " Chạy lại ./deploy.sh để build tiếp (code đã pull không bị bỏ qua)."
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
}
trap on_error ERR

cd "$APP_DIR"

echo "=========================================="
echo " DOSCO ERP DEPLOY"
echo " $(date)"
echo " Log: $LOG_FILE"
echo "=========================================="

# ---- Không deploy nếu có file tracked đang sửa trực tiếp trên VPS ---------
STEP="kiểm tra working tree"
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "ERROR: VPS đang có thay đổi Git chưa commit (git status). Không deploy."
    exit 1
fi

# ---- Mốc so sánh = commit đã deploy xong lần trước -----------------------
STEP="fetch GitHub"
echo
echo "[1/7] Fetch GitHub..."
git fetch origin "$BRANCH"
NEW_COMMIT=$(git rev-parse "origin/$BRANCH")
HEAD_COMMIT=$(git rev-parse HEAD)

DEPLOYED_COMMIT=""
if [ -s "$CURRENT_FILE" ]; then
    DEPLOYED_COMMIT=$(tr -d '[:space:]' < "$CURRENT_FILE")
    # File ghi hash lạ (không có trong repo) -> coi như chưa biết.
    git cat-file -e "$DEPLOYED_COMMIT^{commit}" 2>/dev/null || DEPLOYED_COMMIT=""
fi
if [ -z "$DEPLOYED_COMMIT" ]; then
    # Chưa có mốc (lần đầu dùng script này): coi bản đang chạy là HEAD hiện tại và GHI NGAY,
    # trước khi pull — để nếu build hỏng, lần sau vẫn biết phải build tiếp từ đây.
    DEPLOYED_COMMIT="$HEAD_COMMIT"
    echo "$DEPLOYED_COMMIT" > "$CURRENT_FILE"
fi

if [ "$FORCE" = false ] && [ "$DEPLOYED_COMMIT" = "$NEW_COMMIT" ] && [ "$HEAD_COMMIT" = "$NEW_COMMIT" ]; then
    echo "Không có code mới trên GitHub (đã deploy ${NEW_COMMIT:0:8})."
    exit 0
fi

echo "Đã deploy : $DEPLOYED_COMMIT"
echo "Trên repo : $HEAD_COMMIT"
echo "GitHub    : $NEW_COMMIT"
if [ "$HEAD_COMMIT" != "$DEPLOYED_COMMIT" ] && [ "$FORCE" = false ]; then
    echo "(Lần trước đã pull nhưng chưa deploy xong -> build tiếp từ $DEPLOYED_COMMIT)"
fi

# ---- Quyết định build gì --------------------------------------------------
CHANGED=$(git diff --name-only "$DEPLOYED_COMMIT" "$NEW_COMMIT" || true)
echo
echo "Các file thay đổi:"
echo "${CHANGED:-(không có)}"

DEPLOY_FRONTEND=false
DEPLOY_BACKEND=false
if [ "$FORCE" = true ] || echo "$CHANGED" | grep -Eq '(^docker-compose\.yml$|frontend/Dockerfile|backend/Dockerfile|postgres\.env)'; then
    DEPLOY_FRONTEND=true; DEPLOY_BACKEND=true
fi
echo "$CHANGED" | grep -q '^frontend/' && DEPLOY_FRONTEND=true
echo "$CHANGED" | grep -q '^backend/'  && DEPLOY_BACKEND=true

# ---- Pull -----------------------------------------------------------------
STEP="git pull"
echo
echo "[2/7] Pull code..."
if [ "$HEAD_COMMIT" != "$NEW_COMMIT" ]; then
    git pull --ff-only origin "$BRANCH"
else
    echo "Repo đã ở $NEW_COMMIT, không cần pull."
fi

STEP="docker compose config"
echo
echo "[3/7] Kiểm tra Docker Compose..."
docker compose config >/dev/null
echo "Compose OK"

# ---- Backup DB trước khi đụng backend -------------------------------------
echo
if [ "$DEPLOY_BACKEND" = true ]; then
    STEP="backup PostgreSQL"
    echo "[4/7] Backup PostgreSQL trước deploy..."
    "$BACKUP_SCRIPT"
    echo "Backup OK"
else
    echo "[4/7] Backend không thay đổi -> không cần backup DB."
fi

# ---- Build ----------------------------------------------------------------
echo
echo "[5/7] Build..."
SERVICES=()
if [ "$DEPLOY_FRONTEND" = true ]; then
    STEP="build frontend"
    echo "Build frontend..."
    docker compose build frontend
    SERVICES+=(frontend)
fi
if [ "$DEPLOY_BACKEND" = true ]; then
    STEP="build backend"
    echo "Build backend..."
    docker compose build backend
    STEP="build yunatt-sync"
    echo "Build Yunatt runner..."
    docker compose --profile jobs build yunatt-sync
    SERVICES+=(backend)
fi
if [ ${#SERVICES[@]} -eq 0 ]; then
    echo "Không có thay đổi frontend/backend (chỉ docs/script) -> không build, không restart."
fi

# ---- Restart --------------------------------------------------------------
echo
echo "[6/7] Restart service..."
if [ ${#SERVICES[@]} -gt 0 ]; then
    STEP="restart ${SERVICES[*]}"
    docker compose up -d --force-recreate "${SERVICES[@]}"
else
    echo "Bỏ qua."
fi

# ---- Health check: chờ tới HEALTH_TIMEOUT giây mỗi dịch vụ ---------------
wait_for() {   # wait_for <tên> <url>
    local name="$1" url="$2" i
    for ((i = 1; i <= HEALTH_TIMEOUT; i++)); do
        if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
            echo "$name OK (sau ${i}s)"
            return 0
        fi
        sleep 1
    done
    echo "ERROR: $name không lên sau ${HEALTH_TIMEOUT}s ($url)"
    echo "---- docker compose logs --tail=40 ----"
    docker compose logs --tail=40 2>/dev/null || true
    return 1
}

echo
echo "[7/7] Health check..."
docker compose ps
STEP="health-check PostgreSQL"
docker exec dosco-erp-db pg_isready -U dosco_erp -d dosco_erp
STEP="health-check API"
wait_for "API" "http://127.0.0.1:8000/docs"
STEP="health-check Frontend"
wait_for "Frontend" "http://127.0.0.1:3000/login"
STEP="health-check erp.dosco.vn"
wait_for "erp.dosco.vn" "https://erp.dosco.vn/login"

# ---- Chỉ tới đây mới coi là đã deploy -------------------------------------
echo "$DEPLOYED_COMMIT" > "$PREVIOUS_FILE"
echo "$NEW_COMMIT" > "$CURRENT_FILE"

echo
echo "=========================================="
echo " DEPLOY SUCCESS  ${DEPLOYED_COMMIT:0:8} -> ${NEW_COMMIT:0:8}"
echo " $(date)"
echo "=========================================="
