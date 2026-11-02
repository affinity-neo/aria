#!/bin/bash
cd "$(dirname "$0")"
echo "ARIA 미리 알림 동기화 도우미를 준비합니다."

if ! command -v swiftc >/dev/null 2>&1; then
  echo "Swift 컴파일러를 찾을 수 없습니다."
  echo "터미널에서 xcode-select --install 을 실행한 뒤 다시 시도하세요."
  read -p "Enter를 누르면 종료합니다."
  exit 1
fi

APP_PATH="${TMPDIR:-/tmp}/aria-reminders-sync"
echo "동기화 프로그램을 준비하는 중입니다..."
if ! swiftc -o "$APP_PATH" AriaRemindersSync.swift; then
  echo
  echo "❌ 프로그램 준비에 실패했습니다. 위 오류 내용을 확인해 주세요."
  read -p "Enter를 누르면 종료합니다."
  exit 1
fi

"$APP_PATH"
echo
read -p "종료하려면 Enter를 누르세요."
