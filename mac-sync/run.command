#!/bin/bash
cd "$(dirname "$0")"
echo "ARIA 미리 알림 동기화 도우미를 준비합니다."
if ! command -v swift >/dev/null 2>&1; then
  echo "Swift를 찾을 수 없습니다. macOS의 Xcode Command Line Tools 설치가 필요합니다."
  echo "터미널에서 xcode-select --install 을 실행한 뒤 다시 시도하세요."
  read -p "Enter를 누르면 종료합니다."
  exit 1
fi
swift AriaRemindersSync.swift
echo
read -p "종료하려면 Enter를 누르세요."
