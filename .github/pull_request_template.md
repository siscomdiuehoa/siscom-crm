<!-- Điền đủ các mục. Mục không áp dụng ghi "Không". Không dán bí mật hay dữ liệu thật. -->

## Mục tiêu
<!-- Một hai câu: PR này làm gì và vì sao. -->

## Phạm vi
- Loại: <!-- feat / fix / db / docs / chore / ci -->
- Gói / giai đoạn liên quan: <!-- ví dụ B1.3.2-A -->
- File mới:
- File thay đổi:
- **Không đụng:** <!-- baseline đã nghiệm thu, hợp đồng API, schema/migration, .env, dependency... -->

## Tác động database
- [ ] Không có tác động database
- [ ] Có migration / thay đổi cấu trúc (gắn nhãn `db`; điền phần dưới)
  - Tên migration:
  - [ ] Chỉ cấu trúc, ràng buộc, trigger (không INSERT/COPY dữ liệu thật, không mật khẩu, email, số điện thoại)
  - [ ] Khai báo đồng thời trong `schema.prisma`; `prisma migrate diff` sạch (không đề xuất DROP ngoài ý muốn)
  - [ ] Đã thử trên bản sao database mới (tên: ______), **không** trên `siscom_crm_dev`
  - [ ] Migration đã áp dụng trước đây **không bị sửa** (nội dung, xuống dòng, mã hóa)
  - [ ] Có test ràng buộc và kế hoạch rollback

## Kiểm thử (ghi kết quả thật; chưa chạy thì ghi "chưa chạy" kèm lý do)
- [ ] `npx tsc --noEmit -p tsconfig.json`:
- [ ] `npm run test:unit`:
- [ ] Integration trên database thử (chỉ nếu liên quan):
- [ ] `npm run build` frontend (chỉ nếu liên quan):
- [ ] Không chạy benchmark P1/P2 (trừ khi PR này yêu cầu và đã được duyệt)
- [ ] Không chạy lại bài test đã đạt khi không có thay đổi ảnh hưởng

## Rollback
<!-- Cách quay lại: git revert, chép lại bản sao lưu, công cụ hoàn tác migration (nếu có). -->

## Bảo mật
- [ ] Không có `.env`, khóa, mật khẩu, JWT secret, dump, dữ liệu khách hàng thật trong thay đổi, log hoặc mô tả PR
- [ ] Không mở rộng quyền truy cập; hành vi mặc định vẫn từ chối khi chưa xác thực (nếu liên quan)
- [ ] Thay đổi bảo mật / migration / audit: người duyệt khác tác giả

## Kiến trúc và hợp đồng
- [ ] Giữ Modular Monolith: không import chéo vào nội bộ module khác; `common` không chứa nghiệp vụ
- [ ] Không đổi hợp đồng API đã chốt (hoặc đã nêu rõ và được duyệt)
- [ ] Không thêm dependency (hoặc đã nêu gói, phiên bản ghim, kiểm tra peer)

## Review độc lập (ChatGPT, theo docs/QUY_TRINH_PHOI_HOP_AI.md)
| Vòng | Phạm vi diff (sha..sha) | Kết quả | Lỗi mở (P0/P1/P2/P3) |
|---|---|---|---|
| R1 | | | |
| R2 | | | |
| R3 | | | |

- [ ] Không quá 3 vòng (vòng thêm cần `OWNER_APPROVED_EXTRA_ROUND`)
- [ ] Báo cáo kết luận `[KET-LUAN]` đã gửi Owner trước khi trình merge

## Tài liệu và rủi ro
- [ ] Đã cập nhật tài liệu / PROGRESS liên quan
- Rủi ro và điểm chưa kiểm chứng:
