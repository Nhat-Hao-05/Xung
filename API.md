# Chạy XUNG API local

API dùng Node.js, Express và SQL Server. Website được phục vụ cùng origin với API để session cookie hoạt động; không mở HTML bằng `file://`.

## Chạy lần đầu

1. Mở PowerShell trong thư mục dự án.
2. Chạy `npm install` nếu chưa cài các package.
3. Chạy `npm start`.
4. Mở `http://localhost:3000`.
5. Kiểm tra API tại `http://localhost:3000/api/health`.

Mặc định server kết nối instance SQL Server `MSI`, database `XUNGStore`, bằng Windows Authentication của tài khoản Windows đang chạy `npm start`. Có thể chỉnh các biến `SQL_SERVER`, `SQL_DATABASE`, `SQL_DRIVER`, `PORT` và `SESSION_SECRET` trong `.env`. Không đặt mật khẩu SQL trong JavaScript phía trình duyệt.

`msnodesqlv8` cần ODBC Driver for SQL Server có trên máy. Nếu API báo lỗi driver/ODBC, cài Microsoft ODBC Driver 17 hoặc 18 for SQL Server rồi khởi động lại API.

Nếu npm cảnh báo đã chặn install script của `msnodesqlv8`, duyệt script của package đó rồi chạy `npm rebuild msnodesqlv8`.

## Endpoints

### Công khai

- `GET /api/health`
- `GET /api/categories`
- `GET /api/products?category=laptop&q=blade&sort=price-asc`
- `GET /api/products/:slug`
- `POST /api/auth/register` với JSON gồm `name`, `phone` (10 chữ số), `email`, `address`, `gender` (`male`, `female`, `other` hoặc `unspecified`), `password`; `identityNumber` (CCCD 12 chữ số) là tùy chọn.
- `POST /api/auth/login` với JSON `{ "email": "a@example.com", "password": "mat-khau" }`
- `GET /api/auth/me`
- `PUT /api/auth/profile` (cần đăng nhập) với JSON `{ "name": "Nguyen Van A", "phone": "0912345678", "address": "...", "gender": "unspecified", "identityNumber": "012345678901" }`; số điện thoại phải có 10 chữ số và không trùng tài khoản khác; CCCD 12 chữ số là tùy chọn, để trống sẽ giữ nguyên CCCD đã lưu. CCCD được mã hóa AES-256-GCM trong `IdentityNumberEncrypted`; `IdentityNumberHash` là HMAC riêng để kiểm tra trùng lặp.
- `POST /api/auth/logout`

### Cần đăng nhập

- `GET /api/cart`
- `POST /api/cart/items` với JSON `{ "productSlug": "blade-16", "quantity": 1 }`
- `PUT /api/cart/items/:slug` với JSON `{ "quantity": 2 }`; đặt `0` để xóa dòng hàng
- `DELETE /api/cart/items/:slug`
- `DELETE /api/cart`
- `POST /api/orders` với JSON có `name`, `email`, `phone`, `address`, `city`; có thể gửi thêm `ward`, `district`, `paymentMethod` (`cod` hoặc `bank_transfer`) và `note`. Khi đặt thành công, phản hồi gồm `order` và `receipt` để hiển thị/in hóa đơn.
- `GET /api/orders` trả về danh sách đơn của tài khoản đang đăng nhập, gồm trạng thái, địa chỉ nhận, thanh toán và các sản phẩm trong đơn.
- `POST /api/wishlist/:slug`
- `DELETE /api/wishlist/:slug`

### Quản trị (cần đăng nhập bằng tài khoản có `Role = 'admin'`)

- `GET /api/admin/summary` — tổng quan đơn hàng, doanh thu đã hoàn tất, khách hàng và tồn kho.
- `GET /api/admin/products`
- `POST /api/admin/products` và `PUT /api/admin/products/:id` — thêm/cập nhật sản phẩm.
- `DELETE /api/admin/products/:id` — ẩn sản phẩm, không xóa dữ liệu lịch sử đơn hàng.
- `GET /api/admin/orders` và `PUT /api/admin/orders/:id` với `{ "status": "confirmed", "paymentStatus": "paid" }`.
- `GET /api/admin/users`
- `PUT /api/admin/users/:id/active` với `{ "active": false }` — chỉ áp dụng cho khách hàng; không thể tự khóa hoặc khóa tài khoản quản trị.

Việc phân quyền được kiểm tra ở API bằng dữ liệu trong SQL Server. Ẩn liên kết trên giao diện không thay thế bước kiểm tra quyền của máy chủ.

## Cấp quyền quản trị trong SSMS

1. Mở `database/admin-role-migration.sql` trong SSMS và chạy để thêm cột `Role`. Người dùng hiện có và tài khoản đăng ký mới mặc định là `customer`.
2. Sau khi xác định đúng email tài khoản cần cấp quyền, chạy thủ công:

```sql
USE [XUNGStore];
UPDATE dbo.Users
SET Role = N'admin'
WHERE Email = N'email-cua-ban@example.com';
```

3. Khởi động lại server Node.js, đăng xuất rồi đăng nhập lại tài khoản đó. Không có chức năng tự đăng ký hoặc tự nâng quyền quản trị trên website.

Không cần xóa hoặc tạo lại database. `database/xung.sql` cũng chứa migration idempotent cho cột này nếu đang được dùng để cập nhật schema; file `database/admin-role-migration.sql` là lựa chọn gọn hơn khi chỉ cần cấp vai trò.

API không tự tạo database. `XUNGStore` và các bảng cần có sẵn; tài khoản Windows chạy API phải được SQL Server cấp quyền đọc/ghi các bảng đó. Khi nâng cấp cơ sở dữ liệu hiện có, chạy lại `database/xung.sql` trong SSMS để thêm các cột và chỉ mục duy nhất cho thông tin đăng ký. CCCD được mã hóa AES-256-GCM ở cột `IdentityNumberEncrypted`; `IdentityNumberHash` chỉ dùng để kiểm tra trùng. Cần giữ ổn định và bảo mật `SESSION_SECRET`, vì khóa mã hóa và HMAC được dẫn xuất từ giá trị này.

## Lưu ý bảo mật

- Mật khẩu tài khoản được hash bằng bcrypt trước khi lưu.
- Session cookie là `httpOnly`, được bảo vệ bằng rate limit ở endpoint đăng nhập/đăng ký.
- Live chat tawk.to được nhúng trên các trang qua `js/support-chat.js`. Widget tải JavaScript từ dịch vụ bên thứ ba.
- Session store mặc định trong RAM chỉ phù hợp chạy local/demo; khi triển khai thật cần store bền vững, HTTPS, `SESSION_SECRET` riêng và tài khoản database quyền tối thiểu.
- Không đưa file `.env` hoặc mật khẩu vào Git.
