#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
더비 협의중리스트 자동 참고가격 매칭 — 구글시트 버전.

'위탁장부' 시트의 과거 이력 전체에서, '협의중리스트' 시트 안에 아직 받아갈금액이
정해지지 않은(=지금 협의 중인) 행들에 대해 같은 브랜드+같은 디자인 과거 사례를 찾아
참고 제안가/참고사례 문구를 두 개의 새 컬럼에 자동으로 채워 넣는다.

- 브랜드+디자인 일치 = 필수 매칭 기준 (특이사항까지 똑같을 필요는 없음)
- 원단/가죽까지 같은 사례가 있으면 그 사례를 우선순위로 올려서 보여줌
- 받아갈금액, 브랜드, 디자인 등 기존 컬럼은 절대 건드리지 않음. 새 컬럼만 채움.
- 이미 제안가가 채워진 행은 다시 건드리지 않음 (재실행해도 중복 작업 없음).

필요 환경변수:
  GOOGLE_SERVICE_ACCOUNT_JSON : 서비스계정 JSON 키 파일의 전체 내용 (문자열)
  SPREADSHEET_ID              : 대상 구글시트의 ID (URL의 /d/ 와 /edit 사이 문자열)

선택 환경변수:
  HIST_SHEET_NAME  (기본값: "위탁장부")
  NEG_SHEET_NAME   (기본값: "협의중리스트")
  NEG_HEADER_ROW   (기본값: 3 — 실제 스프레드시트에서 헤더가 있는 행 번호, 1-base)
  MAX_ITEMS_PER_RUN (기본값: 30)
"""
import os
import json
import re
import sys
from datetime import datetime

from google.oauth2 import service_account
from googleapiclient.discovery import build

HIST_SHEET_NAME = os.environ.get("HIST_SHEET_NAME", "위탁장부")
NEG_SHEET_NAME = os.environ.get("NEG_SHEET_NAME", "협의중리스트")
NEG_HEADER_ROW = int(os.environ.get("NEG_HEADER_ROW", "3"))
MAX_ITEMS_PER_RUN = int(os.environ.get("MAX_ITEMS_PER_RUN", "30"))

SUGGEST_AMOUNT_HEADER = "제안가(자동)_받아갈금액"
SUGGEST_TEXT_HEADER = "제안가(자동)_참고사례"

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


def get_service():
    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not raw:
        print("GOOGLE_SERVICE_ACCOUNT_JSON 환경변수가 없습니다.", file=sys.stderr)
        sys.exit(1)
    info = json.loads(raw)
    creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    return build("sheets", "v4", credentials=creds)


def col_letter(idx0):
    """0-base 컬럼 인덱스를 A1 컬럼 문자로 변환."""
    idx = idx0 + 1
    s = ""
    while idx > 0:
        idx, rem = divmod(idx - 1, 26)
        s = chr(65 + rem) + s
    return s


def to_number(v):
    if v is None:
        return None
    s = str(v).strip().replace(",", "")
    if s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_date(v):
    if not v:
        return None
    s = str(v).strip()
    for fmt in ("%Y.%m.%d", "%Y-%m-%d", "%Y%m%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def header_index(headers, name):
    for i, h in enumerate(headers):
        if str(h).strip() == name:
            return i
    return None


def norm_fabric(v):
    """원단/가죽 값을 비교용으로 느슨하게 정규화 (띄어쓰기·대소문자 차이 무시).
    예: '면 100%' 와 '면100%' 는 같은 걸로 취급하지만, '면 100%' 와 '울 100%' 는 다르게 취급."""
    if v is None:
        return ""
    s = str(v).strip()
    s = re.sub(r"\s+", "", s)
    return s.lower()


def main():
    spreadsheet_id = os.environ.get("SPREADSHEET_ID")
    if not spreadsheet_id:
        print("SPREADSHEET_ID 환경변수가 없습니다.", file=sys.stderr)
        sys.exit(1)

    svc = get_service()
    sheets = svc.spreadsheets()

    # ── 위탁장부: 과거 이력 전체 읽기 ──────────────────────────────
    hist_resp = sheets.values().get(
        spreadsheetId=spreadsheet_id, range=f"{HIST_SHEET_NAME}!A1:AF"
    ).execute()
    hist_rows = hist_resp.get("values", [])
    if not hist_rows:
        print(f"{HIST_SHEET_NAME} 시트에 데이터가 없습니다.")
        return
    hist_headers = hist_rows[0]
    h_idx = {
        "브랜드": header_index(hist_headers, "브랜드"),
        "디자인": header_index(hist_headers, "디자인"),
        "사이즈": header_index(hist_headers, "사이즈"),
        "원단": header_index(hist_headers, "원단/가죽"),
        "받아갈금액": header_index(hist_headers, "받아갈금액"),
        "판매금액": header_index(hist_headers, "판매금액"),
        "일자": header_index(hist_headers, "일자"),
        "코드": header_index(hist_headers, "코드"),
        "특이사항": header_index(hist_headers, "새상품(컨디션) / 비고"),
    }
    missing = [k for k, v in h_idx.items() if v is None and k in ("브랜드", "디자인", "받아갈금액")]
    if missing:
        print(f"{HIST_SHEET_NAME} 시트에서 필수 컬럼을 못 찾았습니다: {missing}", file=sys.stderr)
        sys.exit(1)

    def cell(row, key):
        i = h_idx[key]
        if i is None or i >= len(row):
            return None
        return row[i]

    hist_valid = []
    for row in hist_rows[1:]:
        amt = to_number(cell(row, "받아갈금액"))
        if amt is None:
            continue
        brand = str(cell(row, "브랜드") or "").strip()
        design = str(cell(row, "디자인") or "").strip()
        if not brand or not design:
            continue
        hist_valid.append({
            "브랜드": brand,
            "디자인": design,
            "사이즈": str(cell(row, "사이즈") or "").strip(),
            "원단": str(cell(row, "원단") or "").strip(),
            "받아갈금액": amt,
            "판매금액": to_number(cell(row, "판매금액")),
            "일자": cell(row, "일자") or "",
            "일자_dt": parse_date(cell(row, "일자")),
            "코드": cell(row, "코드") or "",
            "특이사항": (cell(row, "특이사항") or "").strip() or "특이사항 없음",
        })

    print(f"{HIST_SHEET_NAME}: 가격 있는 과거 사례 {len(hist_valid)}건 로드")

    # ── 협의중리스트: 헤더 + 데이터 읽기 ──────────────────────────
    neg_range = f"{NEG_SHEET_NAME}!A{NEG_HEADER_ROW}:AF"
    neg_resp = sheets.values().get(spreadsheetId=spreadsheet_id, range=neg_range).execute()
    neg_rows = neg_resp.get("values", [])
    if not neg_rows:
        print(f"{NEG_SHEET_NAME} 시트에 데이터가 없습니다.")
        return
    neg_headers = neg_rows[0]
    n_idx = {
        "브랜드": header_index(neg_headers, "브랜드"),
        "디자인": header_index(neg_headers, "디자인"),
        "사이즈": header_index(neg_headers, "사이즈"),
        "원단": header_index(neg_headers, "원단/가죽"),
        "받아갈금액": header_index(neg_headers, "받아갈금액"),
    }
    missing = [k for k, v in n_idx.items() if v is None and k in ("브랜드", "디자인", "받아갈금액")]
    if missing:
        print(f"{NEG_SHEET_NAME} 시트에서 필수 컬럼을 못 찾았습니다: {missing}", file=sys.stderr)
        sys.exit(1)

    # 제안가 컬럼이 이미 있는지 확인, 없으면 헤더 끝에 새로 추가
    amt_col = header_index(neg_headers, SUGGEST_AMOUNT_HEADER)
    text_col = header_index(neg_headers, SUGGEST_TEXT_HEADER)
    next_col = len(neg_headers)
    header_writes = []
    if amt_col is None:
        amt_col = next_col
        next_col += 1
        header_writes.append((amt_col, SUGGEST_AMOUNT_HEADER))
    if text_col is None:
        text_col = next_col
        next_col += 1
        header_writes.append((text_col, SUGGEST_TEXT_HEADER))

    if header_writes:
        data = [{
            "range": f"{NEG_SHEET_NAME}!{col_letter(c)}{NEG_HEADER_ROW}",
            "values": [[label]],
        } for c, label in header_writes]
        sheets.values().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"valueInputOption": "RAW", "data": data},
        ).execute()
        print(f"새 컬럼 헤더 추가: {[label for _, label in header_writes]}")

    def build_reference(brand, design, size, fabric, max_cases=5):
        matches = [h for h in hist_valid if h["브랜드"] == brand and h["디자인"] == design]
        if not matches:
            return "이전 유사거래 없음 (브랜드+디자인 일치 사례 없음)", None
        fabric_n = norm_fabric(fabric)
        for m in matches:
            m["원단일치"] = bool(fabric_n) and (norm_fabric(m["원단"]) == fabric_n)
            m["사이즈일치"] = (m["사이즈"] == size)
        same_fabric_n = sum(1 for m in matches if m["원단일치"])
        # 원단/가죽까지 같은 사례를 최우선으로, 그다음 최근 날짜 순
        matches.sort(key=lambda m: (not m["원단일치"], -(m["일자_dt"].timestamp() if m["일자_dt"] else 0)))
        top = matches[0]
        lines = []
        for m in matches[:max_cases]:
            cost = f"{int(m['받아갈금액']):,}"
            sale = f"/판매 {int(m['판매금액']):,}" if m["판매금액"] is not None else ""
            tags = []
            if m["원단일치"]:
                tags.append("원단 동일")
            if m["사이즈일치"]:
                tags.append("사이즈 동일")
            tag_s = f" ({', '.join(tags)})" if tags else ""
            fabric_s = m["원단"] or "원단미상"
            size_s = m["사이즈"] or "사이즈미상"
            lines.append(f"[{m['일자']} {m['코드']}] 원단 {fabric_s} / 사이즈 {size_s}{tag_s} 받아갈금액 {cost}{sale} — {m['특이사항']}")
        extra = len(matches) - max_cases
        text = (
            f"이전 유사사례 {len(matches)}건 (브랜드+디자인 일치, 그중 원단까지 같은 사례 {same_fabric_n}건, "
            f"최근순 {min(max_cases, len(matches))}건 표시 · 원단 동일 사례 우선):\n" + "\n".join(lines)
        )
        if extra > 0:
            text += f"\n...외 {extra}건 더 있음"
        return text, int(top["받아갈금액"])

    updates = []
    processed = 0
    for r, row in enumerate(neg_rows[1:], start=NEG_HEADER_ROW + 1):
        if processed >= MAX_ITEMS_PER_RUN:
            break

        def g(idx):
            return row[idx] if idx < len(row) else None

        existing_amt = g(amt_col)
        if existing_amt not in (None, ""):
            continue  # 이미 제안가 채워짐 → 건드리지 않음

        already_priced = to_number(g(n_idx["받아갈금액"]))
        if already_priced is not None:
            continue  # 이미 협의 완료된 건 → 건드리지 않음

        brand = str(g(n_idx["브랜드"]) or "").strip()
        design = str(g(n_idx["디자인"]) or "").strip()
        if not brand or not design:
            continue

        size = str(g(n_idx["사이즈"]) or "").strip()
        fabric = str(g(n_idx["원단"]) or "").strip() if n_idx["원단"] is not None else ""
        text, suggested = build_reference(brand, design, size, fabric)

        updates.append({
            "range": f"{NEG_SHEET_NAME}!{col_letter(text_col)}{r}",
            "values": [[text]],
        })
        if suggested is not None:
            updates.append({
                "range": f"{NEG_SHEET_NAME}!{col_letter(amt_col)}{r}",
                "values": [[suggested]],
            })
        processed += 1

    if updates:
        sheets.values().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"valueInputOption": "USER_ENTERED", "data": updates},
        ).execute()

    print(f"이번 실행에서 처리한 행: {processed}건 (최대 {MAX_ITEMS_PER_RUN}건)")


if __name__ == "__main__":
    main()
