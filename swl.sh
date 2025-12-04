#!/bin/bash
#
# SWL-ka9q control script
# Usage: ./swl.sh {start|stop|restart|status}
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/.swl.pid"
LOG_FILE="$SCRIPT_DIR/swl.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

get_pid() {
    if [ -f "$PID_FILE" ]; then
        cat "$PID_FILE"
    else
        echo ""
    fi
}

is_running() {
    local pid=$(get_pid)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        return 0
    else
        return 1
    fi
}

do_start() {
    if is_running; then
        echo -e "${YELLOW}⚠️  SWL-ka9q is already running (PID: $(get_pid))${NC}"
        return 1
    fi
    
    echo -e "${GREEN}🚀 Starting SWL-ka9q...${NC}"
    
    cd "$SCRIPT_DIR"
    
    # Start server in background, redirect output to log
    nohup node server.js >> "$LOG_FILE" 2>&1 &
    local pid=$!
    echo $pid > "$PID_FILE"
    
    # Wait a moment and check if it started
    sleep 2
    if is_running; then
        echo -e "${GREEN}✅ SWL-ka9q started (PID: $pid)${NC}"
        echo -e "   Log: $LOG_FILE"
        echo -e "   URL: http://localhost:3100/"
        return 0
    else
        echo -e "${RED}❌ Failed to start SWL-ka9q${NC}"
        echo -e "   Check log: $LOG_FILE"
        rm -f "$PID_FILE"
        return 1
    fi
}

do_stop() {
    if ! is_running; then
        echo -e "${YELLOW}⚠️  SWL-ka9q is not running${NC}"
        rm -f "$PID_FILE"
        return 0
    fi
    
    local pid=$(get_pid)
    echo -e "${YELLOW}🛑 Stopping SWL-ka9q (PID: $pid)...${NC}"
    
    kill "$pid" 2>/dev/null
    
    # Wait for graceful shutdown
    local count=0
    while is_running && [ $count -lt 10 ]; do
        sleep 1
        count=$((count + 1))
    done
    
    # Force kill if still running
    if is_running; then
        echo -e "${YELLOW}   Force killing...${NC}"
        kill -9 "$pid" 2>/dev/null
        sleep 1
    fi
    
    rm -f "$PID_FILE"
    echo -e "${GREEN}✅ SWL-ka9q stopped${NC}"
    return 0
}

do_restart() {
    do_stop
    sleep 1
    do_start
}

do_status() {
    if is_running; then
        local pid=$(get_pid)
        echo -e "${GREEN}✅ SWL-ka9q is running (PID: $pid)${NC}"
        echo -e "   URL: http://localhost:3100/"
        echo -e "   Log: $LOG_FILE"
        
        # Show last few log lines
        if [ -f "$LOG_FILE" ]; then
            echo ""
            echo "Recent log entries:"
            tail -5 "$LOG_FILE"
        fi
        return 0
    else
        echo -e "${RED}❌ SWL-ka9q is not running${NC}"
        rm -f "$PID_FILE"
        return 1
    fi
}

case "$1" in
    start|-start|--start)
        do_start
        ;;
    stop|-stop|--stop)
        do_stop
        ;;
    restart|-restart|--restart)
        do_restart
        ;;
    status|-status|--status)
        do_status
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status}"
        echo ""
        echo "Options:"
        echo "  start    Start SWL-ka9q server"
        echo "  stop     Stop SWL-ka9q server"
        echo "  restart  Restart SWL-ka9q server"
        echo "  status   Show server status"
        exit 1
        ;;
esac
