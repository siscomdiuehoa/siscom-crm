#!/usr/bin/env bash
# SISCOM CRM - G5: chay 3 nghiep vu con thieu tren MOI TRUONG THU rieng (http://127.0.0.1:4174, database tam cong 55873,
# ban 2de465c), qua DUNG duong /api/v1 ma giao dien dung (proxy cua vite preview). Du lieu ten bat dau "THU-G5".
# Khong cham he thong that. Khong in mat khau (doc tu TAI-KHOAN-THU.txt cua moi truong thu).
#   N1: Thang + viec ban giao cho Ky thuat
#   N2: Tam hoan -> Tiep tuc (giu giai doan, viec nhac duoc dong)
#   N3: Ky thuat thay viec duoc giao, thay co hoi "theo viec" KHONG co so tien, hoan thanh viec
set -uo pipefail
G="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; W="$G/tmp"; mkdir -p "$W"
O="${G5_ORIGIN:-http://127.0.0.1:4174}"; B=$O/api/v1   # G5_ORIGIN / G5_ACCOUNTS: chi de bo thu dung may chu gia (test-golive-scripts.sh)
ACC="${G5_ACCOUNTS:-}"
fail=0; ok() { echo "  [DAT]       $*"; }; bad() { echo "  [KHONG DAT] $*"; fail=1; }
pw() { awk -v u="$1" '$0 ~ u {print $NF}' "${ACC:-$G/TAI-KHOAN-THU.txt}"; }
login() { # login <email> => ma HTTP; phien vao $W/sid, $W/csrf
  curl -s -o "$W/l.json" -D "$W/h.txt" -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "Origin: $O" \
    --data "{\"login\":\"$1\",\"password\":\"$(pw "$1")\"}" "$B/auth/login"
  sed -n 's/^[Ss]et-[Cc]ookie: *siscom_sid=\([^;]*\).*/\1/p' "$W/h.txt" | tr -d '\r' > "$W/sid"
  sed -n 's/^[Ss]et-[Cc]ookie: *siscom_csrf=\([^;]*\).*/\1/p' "$W/h.txt" | tr -d '\r' > "$W/csrf"
}
api() { # api <METHOD> <path> [json] => than phan hoi vao $W/r.json, in ma HTTP
  curl -s -o "$W/r.json" -w '%{http_code}' -X "$1" -H 'Content-Type: application/json' -H "Origin: $O" -H "X-CSRF-Token: $(cat "$W/csrf")" \
    -H "Cookie: siscom_sid=$(cat "$W/sid"); siscom_csrf=$(cat "$W/csrf")" ${3:+--data "$3"} "$B$2"
}
js() { node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));const f=new Function('j','return ('+process.argv[2]+')');const v=f(j);console.log(typeof v==='object'?JSON.stringify(v):v)" "$W/r.json" "$1"; }
need() { # need <ma> <ky vong> <mo ta>: ky vong 200 thi chap nhan ca 201 (NestJS tra 201 cho POST)
  [ "$1" = "$2" ] || { [ "$2" = 200 ] && [ "$1" = 201 ]; } || { bad "$3: HTTP $1 (ky vong $2) - $(head -c 300 "$W/r.json")"; exit 1; }; }
today="$(date +%Y-%m-%d)"; plus7="$(date -d '+7 day' +%Y-%m-%d 2>/dev/null || node -e "d=new Date(Date.now()+7*864e5);console.log(d.toISOString().slice(0,10))")"
echo "== G5 tren moi truong thu: $(date -u +%Y-%m-%dT%H:%M:%SZ); $(curl -s "$O/api/v1/health/database" | grep -oE '"migrated":[a-z]+') =="

echo "-- Kinh doanh tao khach va co hoi"
c="$(login sale@thu.local)"; need "$c" 200 "dang nhap sale@"
need "$(api GET /opportunities/meta)" 200 "meta"
ST_QUOTE="$(js "j.data.stages.find(s=>s.code==='QUOTATION').id")"; TYPE="$(js 'j.data.types[0].id')"
need "$(api POST /customers '{"name":"THU-G5 Cong ty thu nghiem"}')" 201 "tao khach"
CUS="$(js 'j.data.id')"; echo "  khach: $(js 'j.data.code') THU-G5 Cong ty thu nghiem"
need "$(api POST /opportunities "{\"customerId\":\"$CUS\",\"title\":\"THU-G5 Co hoi thang\",\"typeId\":\"$TYPE\",\"needSummary\":\"THU-G5 khach can lap he thong\",\"expectedAmountVnd\":\"150000000\"}")" 201 "tao co hoi"
OPP="$(js 'j.data.id')"; V="$(js 'j.data.version')"; echo "  co hoi: $(js 'j.data.code') giai doan=$(js 'j.data.stage.label||j.data.stage.code') status=$(js 'j.data.status')"
need "$(api POST "/opportunities/$OPP/stage" "{\"version\":$V,\"stageId\":\"$ST_QUOTE\"}")" 200 "chuyen sang Bao gia"
V="$(js 'j.data.version')"; echo "  chuyen giai doan: $(js 'j.data.stage.label||j.data.stage.code')"

echo "-- N2: Tam hoan -> Tiep tuc"
need "$(api POST "/opportunities/$OPP/hold" "{\"version\":$V,\"holdUntil\":\"$plus7\",\"holdReason\":\"THU-G5 khach hen tuan sau\"}")" 200 "tam hoan"
V="$(js 'j.data.version')"; s="$(js 'j.data.status')"; if [ "$s" = ON_HOLD ]; then ok "Tam hoan: status=ON_HOLD, han=$(js 'j.data.holdUntil')"; else bad "Tam hoan: status=$s"; fi
need "$(api GET "/opportunities/$OPP/activities")" 200 "viec cua co hoi"
echo "  viec tu sinh khi tam hoan: $(js "j.data.items.filter(a=>a.autoKind).map(a=>a.code+' '+a.autoKind+'/'+a.status).join(', ')")"
# Review R2 #256 (HIGH): phai co DUNG MOT viec nhac HOLD_REMINDER dang OPEN; ghi lai id de kiem chinh viec do sau Tiep tuc.
REM="$(js "((a)=>a.length===1?a[0].id:'')(j.data.items.filter(a=>a.autoKind==='HOLD_REMINDER'&&a.status==='OPEN'))")"
if [ -n "$REM" ]; then ok "Tam hoan sinh dung 1 viec nhac HOLD_REMINDER dang OPEN"; else bad "Tam hoan: khong co dung 1 viec nhac HOLD_REMINDER OPEN"; fi
need "$(api POST "/opportunities/$OPP/resume" "{\"version\":$V,\"reason\":\"THU-G5 khach goi lai\"}")" 200 "tiep tuc"
V="$(js 'j.data.version')"; s="$(js 'j.data.status')"; st="$(js 'j.data.stage.code')"
if [ "$s" = OPEN ] && [ "$st" = QUOTATION ]; then ok "Tiep tuc: status=OPEN, giu giai doan=$st"; else bad "Tiep tuc: status=$s giai doan=$st"; fi
need "$(api GET "/opportunities/$OPP/activities")" 200 "viec cua co hoi"
echo "  viec tu sinh sau tiep tuc: $(js "j.data.items.filter(a=>a.autoKind).map(a=>a.code+' '+a.autoKind+'/'+a.status).join(', ')")"
rs="$(js "((a)=>a?a.status:'KHONG THAY')(j.data.items.find(a=>a.id==='$REM'))")"
if [ -n "$REM" ] && [ "$rs" = CANCELLED ]; then ok "Tiep tuc: chinh viec nhac do chuyen CANCELLED"; else bad "Tiep tuc: viec nhac co trang thai $rs (ky vong CANCELLED)"; fi
openrem="$(js "j.data.items.filter(a=>a.autoKind==='HOLD_REMINDER'&&a.status==='OPEN').length")"
if [ "$openrem" = 0 ]; then ok "Tiep tuc: khong con viec nhac HOLD_REMINDER nao OPEN"; else bad "Tiep tuc: con $openrem viec nhac OPEN"; fi

echo "-- N1: Thang + viec ban giao cho Ky thuat"
need "$(api GET "/opportunities/$OPP/handover-candidates")" 200 "danh sach nguoi nhan ban giao"
TECH="$(js "(j.data.items||j.data).find(e=>/kythuat@/.test(e.email||'')||/NV-0004/.test(e.code||'')).id")"
echo "  nguoi nhan ban giao: $(js "(j.data.items||j.data).map(e=>(e.code||'')+' '+(e.email||e.fullName||'')).join(' | ')")"
need "$(api POST "/opportunities/$OPP/win" "{\"version\":$V,\"wonAmountVnd\":\"148500000\",\"wonDocType\":\"HOP_DONG\",\"wonDocNo\":\"THU-G5-HD-001\",\"wonDocDate\":\"$today\",\"wonDocUrl\":\"https://example.com/thu-g5-hd-001.pdf\",\"handoverToId\":\"$TECH\"}")" 200 "Thang"
# Review R2 #256 (HIGH): khong chi status=WON - gia tri chot va chung tu phai DUNG nhu da gui, ca trong phan hoi lan khi doc lai.
wonchk() { js "((d)=>{const e={status:'WON',wonAmountVnd:'148500000',wonDocType:'HOP_DONG',wonDocNo:'THU-G5-HD-001',wonDocUrl:'https://example.com/thu-g5-hd-001.pdf'};const x=Object.keys(e).filter(k=>String(d[k])!==e[k]);if(!String(d.wonDocDate||'').startsWith('$today'))x.push('wonDocDate');return x.length?x.map(k=>k+'='+d[k]).join(', '):'OK'})(j.data)"; }
w="$(wonchk)"; if [ "$w" = OK ]; then ok "Thang (phan hoi): status=WON, gia tri chot=148500000, chung tu HOP_DONG THU-G5-HD-001, ngay, duong dan dung"; else bad "Thang (phan hoi) sai: $w"; fi
need "$(api GET "/opportunities/$OPP")" 200 "Kinh doanh doc lai co hoi sau Thang"
w="$(wonchk)"; if [ "$w" = OK ]; then ok "Thang (doc lai): du lieu da luu dung"; else bad "Thang (doc lai) sai: $w"; fi
need "$(api GET "/opportunities/$OPP/activities")" 200 "viec cua co hoi"
H="$(js "j.data.items.find(a=>a.autoKind==='WIN_HANDOVER')")"
if [ -n "$H" ] && [ "$H" != undefined ]; then ok "co viec ban giao: $(js "((a)=>a.code+' '+a.status+' giao cho='+(a.performedBy&&(a.performedBy.code||a.performedBy.fullName)))(j.data.items.find(a=>a.autoKind==='WIN_HANDOVER'))")"; else bad "khong thay viec ban giao"; fi

echo "-- N3: Ky thuat thay viec duoc giao, khong thay so tien, hoan thanh viec"
c="$(login kythuat@thu.local)"; need "$c" 200 "dang nhap kythuat@"
need "$(api GET "/activities?assignee=me")" 200 "Cong viec cua toi"
TASK="$(js "(j.data.items||[]).find(a=>a.opportunityId==='$OPP'||(a.opportunity&&a.opportunity.id==='$OPP'))")"
if [ -n "$TASK" ] && [ "$TASK" != undefined ]; then ok "Ky thuat thay viec ban giao trong 'Cong viec cua toi'"; TID="$(js "j.data.items.find(a=>a.opportunityId==='$OPP'||(a.opportunity&&a.opportunity.id==='$OPP')).id")"
else bad "Ky thuat KHONG thay viec ban giao (so viec: $(js '(j.data.items||[]).length'))"; TID=""; fi
code="$(api GET "/opportunities/$OPP")"
# Review R2 #256 (HIGH): Ky thuat PHAI mo duoc co hoi (HTTP 200) qua duong "theo viec"; khac 200 la KHONG DAT.
if [ "$code" = 200 ]; then
  ok "Ky thuat mo duoc co hoi theo viec: HTTP 200, access=$(js 'j.data.access')"
  amt="$(js "['expectedAmountVnd','wonAmountVnd','wonDocNo','wonDocUrl','wonDocFileName'].filter(k=>j.data[k]!==undefined&&j.data[k]!==null)")"
  if [ "$amt" = "[]" ]; then ok "co hoi theo viec KHONG tra so tien / chung tu (truong tra ve: $(js 'Object.keys(j.data).length') truong)"; else bad "Ky thuat thay truong nhay cam: $amt"; fi
else
  bad "Ky thuat KHONG mo duoc co hoi theo viec: HTTP $code - $(head -c 200 "$W/r.json")"
fi
if [ -n "$TID" ]; then
  need "$(api GET "/activities/$TID")" 200 "chi tiet viec"; TV="$(js 'j.data.version')"
  need "$(api POST "/activities/$TID/complete" "{\"version\":$TV,\"outcome\":\"THU-G5 da nhan ban giao\"}")" 200 "hoan thanh viec"
  if [ "$(js 'j.data.status')" = DONE ]; then ok "Ky thuat hoan thanh viec ban giao: status=DONE"; else bad "hoan thanh: status=$(js 'j.data.status')"; fi
fi

echo; if [ "$fail" = 0 ]; then echo "KET QUA G5 (API): 3 nghiep vu deu DAT"; else echo "KET QUA G5 (API): CO MUC KHONG DAT"; fi
exit "$fail"
