#!/bin/bash
# DOSCO ERP — bọc deploy.sh và báo Telegram. Đặt tại /opt/dosco-erp/deploy-with-telegram.sh.
# Khác bản cũ: tin FAILED kèm bước lỗi + 15 dòng log cuối; "có code mới hay không"
# dựa trên current_commit (commit đã deploy xong) chứ không phải HEAD của repo.
set -u

BASE_DIR="/opt/dosco-erp"
ENV_FILE="$BASE_DIR/deploy-telegram.env"
DEPLOY_SCRIPT="$BASE_DIR/deploy.sh"
CURRENT_FILE="$BASE_DIR/current_commit"
LATEST_LOG="$BASE_DIR/logs/deploy-latest.log"

# shellcheck disable=SC1090
source "$ENV_FILE"

notify() {
    /usr/bin/curl -fsS --max-time 15 -X POST \
        "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
        --data-urlencode "text=$1" \
        >/dev/null 2>&1 || true
}

read_commit() { tr -d '[:space:]' < "$CURRENT_FILE" 2>/dev/null || echo "unknown"; }

START_TIME=$(date +%s)
HOST=$(hostname)
BEFORE_COMMIT=$(read_commit)

notify "🚀 DOSCO ERP DEPLOY STARTED
Server: $HOST
Time: $(date '+%d/%m/%Y %H:%M:%S')"

"$DEPLOY_SCRIPT" "$@"
EXIT_CODE=$?

DURATION=$(( $(date +%s) - START_TIME ))
AFTER_COMMIT=$(read_commit)
# deploy-latest.log là symlink do deploy.sh tạo; lỡ thiếu thì lấy file log mới nhất.
[ -r "$LATEST_LOG" ] || LATEST_LOG=$(ls -t "$BASE_DIR"/logs/deploy-*.log 2>/dev/null | head -n 1)

if [ "$EXIT_CODE" -ne 0 ]; then
    FAILED_STEP=$(grep -m1 'DEPLOY FAILED tại bước' "$LATEST_LOG" 2>/dev/null | sed 's/.*bước: //' || true)
    # Bỏ dòng khung báo lỗi, lấy 15 dòng cuối, cắt cho vừa giới hạn 4096 ký tự của Telegram.
    TAIL=$(grep -v '^!!!!' "$LATEST_LOG" 2>/dev/null | grep -v 'DEPLOY FAILED tại bước' | tail -n 15 | cut -c1-200 | tail -c 3000)
    notify "❌ DOSCO ERP DEPLOY FAILED

Server: $HOST
Bước lỗi: ${FAILED_STEP:-không rõ}
Exit code: $EXIT_CODE
Duration: ${DURATION}s
Time: $(date '+%d/%m/%Y %H:%M:%S')
Log: $LATEST_LOG

--- log cuối ---
$TAIL

Bấm deploy lại là build tiếp, code đã pull không bị bỏ qua."

elif [ "$BEFORE_COMMIT" = "$AFTER_COMMIT" ]; then
    notify "ℹ️ DOSCO ERP - NO NEW CODE

Server: $HOST
Commit: ${AFTER_COMMIT:0:8}
Duration: ${DURATION}s
Time: $(date '+%d/%m/%Y %H:%M:%S')"

else
    notify "✅ DOSCO ERP DEPLOY SUCCESS

Server: $HOST
Old: ${BEFORE_COMMIT:0:8}
New: ${AFTER_COMMIT:0:8}
Duration: ${DURATION}s
Time: $(date '+%d/%m/%Y %H:%M:%S')"
fi

exit "$EXIT_CODE"
