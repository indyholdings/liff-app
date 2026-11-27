# แผนผัง Supabase ของ indyholdings

อัปเดต 27 พ.ย. 2026 · org เดียว (Pro) · ทุก project อยู่ที่ Singapore (ap-southeast-1)

ชื่อ project ใน Supabase เปลี่ยนได้โดยไม่กระทบระบบ เพราะ URL ผูกกับ ref ไม่ใช่ชื่อ
ref, URL ของ function และ Webhook URL ที่ตั้งใน LINE จึงใช้ได้เหมือนเดิมหลังเปลี่ยนชื่อ

## Projects

| ref | ชื่อตอนนี้ | ชื่อที่แนะนำ | ข้างในมีอะไร |
|---|---|---|---|
| `ihbmufkwqgxzpyoepajz` | `jaifu-one` | `indy-shared · JAIFU ONE + Hidden + BaanNu` | ใช้ร่วมหลายธุรกิจ ดูตารางด้านล่าง |
| `chhjzarnfmripqvhoclm` | `gbl-connect` | `globallink · gbl-connect` | Globallink Estate เท่านั้น |
| `rdhpuadqooelderputqo` | `patio-boutique` | — | ไม่ใช่งานชุดนี้ ยังไม่ได้แตะ (public 40 ตาราง) |

ชื่อ `jaifu-one` ทำให้เข้าใจผิดได้ เพราะใน project นี้มีข้อมูลของธุรกิจอื่นด้วย ไม่ได้มีแค่ JAIFU LINE OA

### `ihbmufkwqgxzpyoepajz`: แยกตามธุรกิจ

| ธุรกิจ | Schema / ตาราง | Edge Functions | LINE OA | Secret ที่ใช้ |
|---|---|---|---|---|
| JAIFU ONE (บอทหลังการขาย / สินเชื่อ) | `public`: persons, loans, rules, events, line_link_codes, profiles, edit_requests, person_documents | `line-webhook`, `line-send`, `user-admin` | OA หลังการขาย JAIFU ONE | `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` |
| JAIFU ฝ่ายขาย (Sidecar CRM) | `sidecar` (10 ตาราง), bucket `sidecar-media` | `sidecar` (v0.2) | OA ฝ่ายขาย JAIFU (คนละ OA กับหลังการขาย) | `SIDECAR_*`, `ANTHROPIC_API_KEY` |
| Hidden Detailing Studio | `hidden` (31 ตาราง) | — | — | — |
| BaanNu | `public.bn_*` (bn_leads, bn_listings, bn_profiles ฯลฯ) | — | — | — |

Secret ของ Edge Function ใช้ร่วมกันทั้ง project ดังนั้น Sidecar จึงอ่านเฉพาะชื่อที่ขึ้นต้นด้วย `SIDECAR_`
ไม่ใช้ `LINE_CHANNEL_*` ของ JAIFU ONE การตั้ง Sidecar จึงไม่กระทบบอทหลังการขาย

### `chhjzarnfmripqvhoclm`: Globallink Estate

| ส่วน | ค่า |
|---|---|
| Schema | `sidecar` (10 ตาราง) + bucket `sidecar-media` |
| Edge Function | `sidecar` v0.2 · profile `real_estate` (เมื่อตั้ง secret `SIDECAR_PROFILE=real_estate`) |
| LINE OA | `@fuk5121a` |
| ตั้งค่าร้าน | shop_name "Globallink Estate" |
| ใช้ต่อในอนาคต | ระบบหลักของ GBL Connect (Blueprint v1.0) |

## URL ของ Sidecar

| ธุรกิจ | API / Webhook |
|---|---|
| JAIFU ฝ่ายขาย | `https://ihbmufkwqgxzpyoepajz.supabase.co/functions/v1/sidecar` (Webhook: ต่อท้าย `/webhook`) |
| Globallink | `https://chhjzarnfmripqvhoclm.supabase.co/functions/v1/sidecar` (Webhook: ต่อท้าย `/webhook`) |

## เปลี่ยนชื่อ (ทำใน dashboard ใช้เวลาประมาณ 2 นาที)

เครื่องมือของผมเปลี่ยนชื่อ org หรือ project ไม่ได้

1. **Org:** Organization settings → General → Name → `indyholdings`
2. **Project:** เปิด project → Project Settings → General → Project name → ใส่ชื่อจากตารางด้านบน

## กติกาตั้งชื่อต่อจากนี้

- ชื่อ project ใช้รูปแบบ `<ธุรกิจ> · <ระบบ>` ถ้าใช้ร่วมหลายธุรกิจให้ขึ้นต้นด้วย `indy-shared`
- หนึ่งธุรกิจใช้หนึ่ง schema และชื่อ schema บอกว่าเป็นของธุรกิจไหน (`sidecar`, `hidden`, `bn_*`)
- Secret ใช้ prefix ของระบบตัวเอง (`SIDECAR_`, `LINE_` …) เพราะทุก function ใน project เห็น secret ชุดเดียวกัน
- LINE OA หนึ่งตัวมี Webhook URL เดียว ให้จดไว้ในตารางด้านบนว่า OA ไหนชี้ไปที่ function ไหน
