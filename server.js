require("dotenv").config();

const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const sql = require("mssql/msnodesqlv8");

const app = express();
const port = Number(process.env.PORT || 3000);
const root = __dirname;
const isProduction = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET || (isProduction ? "" : "xung-local-development-secret-change-me");

if (!sessionSecret) {
  throw new Error("SESSION_SECRET is required when NODE_ENV=production.");
}

const sqlServer = process.env.SQL_SERVER || "MSI\\SQLEXPRESS";
const sqlDatabase = process.env.SQL_DATABASE || "XUNGStore";
const sqlDriver = process.env.SQL_DRIVER || "ODBC Driver 17 for SQL Server";
const connectionString = [
  `Driver={${sqlDriver}}`,
  `Server=${sqlServer}`,
  `Database=${sqlDatabase}`,
  "Trusted_Connection=yes",
  "TrustServerCertificate=yes",
].join(";") + ";";

const pool = new sql.ConnectionPool({
  connectionString,
  connectionTimeout: 10000,
  requestTimeout: 15000,
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
});

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "32kb" }));
app.use(session({
  name: "xung.sid",
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 8,
  },
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Bạn thử quá nhiều lần. Vui lòng chờ ít phút rồi thử lại." },
});

function apiError(res, status, message) {
  return res.status(status).json({ error: message });
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return apiError(res, 401, "Vui lòng đăng nhập để tiếp tục.");
  next();
}

async function requireAdmin(req, res, next) {
  if (!req.session.userId) return apiError(res, 401, "Vui lòng đăng nhập để tiếp tục.");
  try {
    const result = await pool.request()
      .input("UserId", sql.Int, req.session.userId)
      .query("SELECT Role, IsActive FROM dbo.Users WHERE UserId = @UserId;");
    const user = result.recordset[0];
    if (!user || !user.IsActive) return apiError(res, 401, "Tài khoản không còn hoạt động.");
    if (user.Role !== "admin") return apiError(res, 403, "Bạn không có quyền truy cập khu vực quản trị.");
    req.session.user = req.session.user || {};
    req.session.user.role = user.Role;
    next();
  } catch (error) {
    next(error);
  }
}

function safeUser(row) {
  return {
    id: row.UserId,
    name: row.FullName,
    email: row.Email,
    phone: row.Phone,
    address: row.Address,
    gender: row.Gender,
    hasIdentityNumber: Boolean(row.HasIdentityNumber),
    role: row.Role || "customer",
  };
}

function hashIdentityNumber(identityNumber) {
  return identityNumber
    ? crypto.createHmac("sha256", sessionSecret).update(`xung-cccd:${identityNumber}`).digest("hex")
    : null;
}

function encryptIdentityNumber(identityNumber) {
  if (!identityNumber) return null;
  const key = crypto.createHmac("sha256", sessionSecret)
    .update("xung-cccd-encryption-key-v1")
    .digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(identityNumber, "utf8"),
    cipher.final(),
  ]);
  return `v1.${iv.toString("hex")}.${cipher.getAuthTag().toString("hex")}.${ciphertext.toString("hex")}`;
}

function establishSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(error => {
      if (error) return reject(error);
      req.session.userId = user.id;
      req.session.user = user;
      req.session.save(saveError => saveError ? reject(saveError) : resolve());
    });
  });
}

function toProduct(row) {
  return {
    id: row.Slug,
    slug: row.Slug,
    category: row.CategorySlug,
    group: row.CategorySlug,
    tag: row.Badge || "XUNG",
    hot: Boolean(row.IsFeatured),
    cat: row.CategoryName,
    name: row.Name,
    spec: row.Specifications,
    rating: `${Number(row.Rating).toLocaleString("vi-VN")} · ${row.ReviewCount} đánh giá`,
    ratingValue: Number(row.Rating),
    reviewCount: row.ReviewCount,
    price: Number(row.Price),
    oldPrice: row.CompareAtPrice == null ? null : Number(row.CompareAtPrice),
    image: row.ImageUrl,
    detail: row.Detail,
    description: row.ShortDescription,
    stockQuantity: row.StockQuantity,
  };
}

const productSelect = `
  SELECT p.Slug, c.Slug AS CategorySlug, c.Name AS CategoryName,
         p.Badge, p.IsFeatured, p.Name, p.Specifications, p.Rating,
         p.ReviewCount, p.Price, p.CompareAtPrice, p.ImageUrl, p.Detail,
         p.ShortDescription, p.StockQuantity
  FROM dbo.Products AS p
  INNER JOIN dbo.Categories AS c ON c.CategoryId = p.CategoryId`;

async function getCartId(userId, transaction) {
  const request = new sql.Request(transaction);
  const result = await request
    .input("UserId", sql.Int, userId)
    .query(`
      DECLARE @CartId BIGINT;
      SELECT TOP (1) @CartId = CartId
      FROM dbo.Carts WITH (UPDLOCK, HOLDLOCK)
      WHERE UserId = @UserId AND IsActive = 1
      ORDER BY CartId DESC;
      IF @CartId IS NULL
      BEGIN
        INSERT INTO dbo.Carts (UserId, IsActive) VALUES (@UserId, 1);
        SET @CartId = CONVERT(BIGINT, SCOPE_IDENTITY());
      END;
      SELECT @CartId AS CartId;
    `);
  return result.recordset[0].CartId;
}

async function readCart(userId, transaction = null) {
  const cartId = await getCartId(userId, transaction || pool);
  const request = new sql.Request(transaction || pool);
  const result = await request
    .input("CartId", sql.BigInt, cartId)
    .query(`
      SELECT p.Slug AS id, p.Slug, p.Name, p.ImageUrl AS image,
             p.Specifications AS spec, p.Price AS price, ci.Quantity AS quantity,
             CAST(p.Price * ci.Quantity AS DECIMAL(18,2)) AS lineTotal
      FROM dbo.CartItems AS ci
      INNER JOIN dbo.Products AS p ON p.ProductId = ci.ProductId
      WHERE ci.CartId = @CartId
      ORDER BY ci.AddedAt;
    `);
  const items = result.recordset.map(item => ({
    ...item,
    price: Number(item.price),
    quantity: Number(item.quantity),
    lineTotal: Number(item.lineTotal),
  }));
  return {
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: items.reduce((sum, item) => sum + item.lineTotal, 0),
  };
}

app.get("/api/health", async (req, res) => {
  try {
    const result = await pool.request().query("SELECT DB_NAME() AS databaseName;");
    res.json({ ok: true, database: result.recordset[0].databaseName });
  } catch (error) {
    console.error("Database health check failed:", error.message);
    apiError(res, 503, "API chưa kết nối được SQL Server. Kiểm tra SQL Server instance và quyền của tài khoản Windows đang chạy server.");
  }
});

app.get("/api/categories", async (req, res, next) => {
  try {
    const result = await pool.request().query(`
      SELECT Slug AS slug, Name AS name, Description AS description
      FROM dbo.Categories WHERE IsActive = 1 ORDER BY Name;
    `);
    res.json(result.recordset);
  } catch (error) { next(error); }
});

app.get("/api/products", async (req, res, next) => {
  try {
    const request = pool.request();
    const where = ["p.IsActive = 1", "c.IsActive = 1"];
    const category = String(req.query.category || "").trim();
    const search = String(req.query.q || "").trim();
    const sort = String(req.query.sort || "featured");
    if (category) {
      where.push("c.Slug = @Category");
      request.input("Category", sql.NVarChar(80), category);
    }
    if (search) {
      where.push("(p.Name LIKE @Search OR p.ShortDescription LIKE @Search OR p.Specifications LIKE @Search)");
      request.input("Search", sql.NVarChar(200), `%${search.slice(0, 100)}%`);
    }
    if (req.query.featured === "true") where.push("p.IsFeatured = 1");
    const orderBy = {
      "price-asc": "p.Price ASC, p.Name ASC",
      "price-desc": "p.Price DESC, p.Name ASC",
      sale: "(ISNULL(p.CompareAtPrice, p.Price) - p.Price) DESC, p.Name ASC",
      featured: "p.IsFeatured DESC, p.ProductId ASC",
    }[sort] || "p.IsFeatured DESC, p.ProductId ASC";
    const result = await request.query(`${productSelect} WHERE ${where.join(" AND ")} ORDER BY ${orderBy};`);
    res.json(result.recordset.map(toProduct));
  } catch (error) { next(error); }
});

app.get("/api/products/:slug", async (req, res, next) => {
  try {
    const result = await pool.request()
      .input("Slug", sql.NVarChar(100), req.params.slug)
      .query(`${productSelect} WHERE p.Slug = @Slug AND p.IsActive = 1 AND c.IsActive = 1;`);
    if (!result.recordset.length) return apiError(res, 404, "Không tìm thấy sản phẩm.");
    res.json(toProduct(result.recordset[0]));
  } catch (error) { next(error); }
});

app.post("/api/auth/register", authLimiter, async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const phone = String(req.body.phone || "").trim();
    const address = String(req.body.address || "").trim();
    const gender = String(req.body.gender || "").trim();
    const identityNumber = String(req.body.identityNumber || "").trim();
    const password = String(req.body.password || "");
    if (name.length < 2 || name.length > 160) return apiError(res, 400, "Họ tên phải từ 2 đến 160 ký tự.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return apiError(res, 400, "Email không hợp lệ.");
    if (!/^\d{10}$/.test(phone)) return apiError(res, 400, "Số điện thoại phải gồm đúng 10 chữ số.");
    if (!address || address.length > 300) return apiError(res, 400, "Địa chỉ không được để trống và tối đa 300 ký tự.");
    if (!["male", "female", "other", "unspecified"].includes(gender)) return apiError(res, 400, "Vui lòng chọn giới tính hợp lệ.");
    if (identityNumber && !/^\d{12}$/.test(identityNumber)) return apiError(res, 400, "Số CCCD phải gồm đúng 12 chữ số.");
    if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) return apiError(res, 400, "Mật khẩu cần dài từ 8 ký tự và tối đa 72 byte.");
    const identityNumberHash = hashIdentityNumber(identityNumber);
    const identityNumberEncrypted = encryptIdentityNumber(identityNumber);
    const duplicateResult = await pool.request()
      .input("Email", sql.NVarChar(254), email)
      .input("Phone", sql.NVarChar(10), phone)
      .input("IdentityNumberHash", sql.Char(64), identityNumberHash)
      .query(`
        SELECT
          CASE WHEN EXISTS (SELECT 1 FROM dbo.Users WHERE Email = @Email) THEN 'email'
               WHEN EXISTS (SELECT 1 FROM dbo.Users WHERE Phone = @Phone) THEN 'phone'
               WHEN @IdentityNumberHash IS NOT NULL AND EXISTS (
                 SELECT 1 FROM dbo.Users WHERE IdentityNumberHash = @IdentityNumberHash
               ) THEN 'identityNumber'
          END AS DuplicateField;
      `);
    const duplicateField = duplicateResult.recordset[0].DuplicateField;
    if (duplicateField === "email") return apiError(res, 409, "Email này đã được đăng ký.");
    if (duplicateField === "phone") return apiError(res, 409, "Số điện thoại này đã được đăng ký.");
    if (duplicateField === "identityNumber") return apiError(res, 409, "Số CCCD này đã được đăng ký.");
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.request()
      .input("FullName", sql.NVarChar(160), name)
      .input("Email", sql.NVarChar(254), email)
      .input("Phone", sql.NVarChar(10), phone)
      .input("Address", sql.NVarChar(300), address)
      .input("Gender", sql.NVarChar(20), gender)
      .input("IdentityNumberHash", sql.Char(64), identityNumberHash)
      .input("IdentityNumberEncrypted", sql.NVarChar(128), identityNumberEncrypted)
      .input("PasswordHash", sql.NVarChar(255), passwordHash)
      .query(`
        INSERT INTO dbo.Users (FullName, Email, PasswordHash, Phone, Address, Gender, IdentityNumberHash, IdentityNumberEncrypted)
        OUTPUT inserted.UserId, inserted.FullName, inserted.Email,
               inserted.Phone, inserted.Address, inserted.Gender, inserted.Role,
               CASE WHEN inserted.IdentityNumberEncrypted IS NULL THEN 0 ELSE 1 END AS HasIdentityNumber
        VALUES (@FullName, @Email, @PasswordHash, @Phone, @Address, @Gender, @IdentityNumberHash, @IdentityNumberEncrypted);
      `);
    const user = safeUser(result.recordset[0]);
    await establishSession(req, user);
    res.status(201).json({ user });
  } catch (error) {
    if (error.number === 2627 || error.number === 2601) {
      if (error.message.includes("UQ_Users_Email")) return apiError(res, 409, "Email này đã được đăng ký.");
      if (error.message.includes("UX_Users_Phone")) return apiError(res, 409, "Số điện thoại này đã được đăng ký.");
      if (error.message.includes("UX_Users_IdentityNumberHash")) return apiError(res, 409, "Số CCCD này đã được đăng ký.");
      return apiError(res, 409, "Email, số điện thoại hoặc CCCD đã được đăng ký.");
    }
    next(error);
  }
});

app.post("/api/auth/login", authLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!email || !password) return apiError(res, 400, "Vui lòng nhập email và mật khẩu.");
    const result = await pool.request()
      .input("Email", sql.NVarChar(254), email)
      .query(`
        SELECT TOP (1) UserId, FullName, Email, PasswordHash, Phone, Address, Gender, Role,
               CASE WHEN IdentityNumberEncrypted IS NULL THEN 0 ELSE 1 END AS HasIdentityNumber
        FROM dbo.Users WHERE Email = @Email AND IsActive = 1;
      `);
    const row = result.recordset[0];
    if (!row || !(await bcrypt.compare(password, row.PasswordHash))) return apiError(res, 401, "Email hoặc mật khẩu chưa chính xác.");
    const user = safeUser(row);
    await establishSession(req, user);
    res.json({ user });
  } catch (error) { next(error); }
});

app.get("/api/auth/me", async (req, res, next) => {
  if (!req.session.userId) return res.json({ user: null });
  try {
    const result = await pool.request()
      .input("UserId", sql.Int, req.session.userId)
      .query(`
        SELECT UserId, FullName, Email, Phone, Address, Gender, Role,
               CASE WHEN IdentityNumberEncrypted IS NULL THEN 0 ELSE 1 END AS HasIdentityNumber
        FROM dbo.Users
        WHERE UserId = @UserId AND IsActive = 1;
      `);
    if (!result.recordset.length) return apiError(res, 401, "Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.");
    const user = safeUser(result.recordset[0]);
    req.session.user = user;
    res.json({ user });
  } catch (error) { next(error); }
});

app.put("/api/auth/profile", requireAuth, async (req, res, next) => {
  const name = String(req.body.name || "").trim();
  const phone = String(req.body.phone || "").trim();
  const address = String(req.body.address || "").trim();
  const gender = String(req.body.gender || "").trim();
  const identityNumber = String(req.body.identityNumber || "").trim();
  if (name.length < 2 || name.length > 160) return apiError(res, 400, "Họ tên phải từ 2 đến 160 ký tự.");
  if (!/^\d{10}$/.test(phone)) return apiError(res, 400, "Số điện thoại phải gồm đúng 10 chữ số.");
  if (!address || address.length > 300) return apiError(res, 400, "Địa chỉ không được để trống và tối đa 300 ký tự.");
  if (!["male", "female", "other", "unspecified"].includes(gender)) return apiError(res, 400, "Vui lòng chọn giới tính hợp lệ.");
  if (identityNumber && !/^\d{12}$/.test(identityNumber)) return apiError(res, 400, "Số CCCD phải gồm đúng 12 chữ số.");
  try {
    const identityNumberHash = identityNumber ? hashIdentityNumber(identityNumber) : null;
    const identityNumberEncrypted = encryptIdentityNumber(identityNumber);
    const result = await pool.request()
      .input("UserId", sql.Int, req.session.userId)
      .input("FullName", sql.NVarChar(160), name)
      .input("Phone", sql.NVarChar(10), phone)
      .input("Address", sql.NVarChar(300), address)
      .input("Gender", sql.NVarChar(20), gender)
      .input("IdentityNumberHash", sql.Char(64), identityNumberHash)
      .input("IdentityNumberEncrypted", sql.NVarChar(128), identityNumberEncrypted)
      .query(`
        UPDATE dbo.Users
        SET FullName = @FullName,
            Phone = @Phone,
            Address = @Address,
            Gender = @Gender,
            IdentityNumberHash = COALESCE(@IdentityNumberHash, IdentityNumberHash),
            IdentityNumberEncrypted = COALESCE(@IdentityNumberEncrypted, IdentityNumberEncrypted),
            UpdatedAt = SYSUTCDATETIME()
        OUTPUT inserted.UserId, inserted.FullName, inserted.Email,
               inserted.Phone, inserted.Address, inserted.Gender, inserted.Role,
               CASE WHEN inserted.IdentityNumberEncrypted IS NULL THEN 0 ELSE 1 END AS HasIdentityNumber
        WHERE UserId = @UserId AND IsActive = 1;
      `);
    if (!result.recordset.length) return apiError(res, 401, "Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.");
    const user = safeUser(result.recordset[0]);
    req.session.user = user;
    res.json({ user });
  } catch (error) {
    if (error.number === 2601 || error.number === 2627) {
      if (error.message.includes("UX_Users_IdentityNumberHash")) return apiError(res, 409, "Số CCCD này đã được đăng ký.");
      return apiError(res, 409, "Số điện thoại này đã được đăng ký.");
    }
    next(error);
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(error => {
    if (error) return apiError(res, 500, "Không thể đăng xuất. Vui lòng thử lại.");
    res.clearCookie("xung.sid", { httpOnly: true, sameSite: "lax", secure: isProduction });
    res.json({ ok: true });
  });
});

app.get("/api/cart", requireAuth, async (req, res, next) => {
  try { res.json(await readCart(req.session.userId)); }
  catch (error) { next(error); }
});

app.post("/api/cart/items", requireAuth, async (req, res, next) => {
  const slug = String(req.body.productSlug || "").trim();
  const quantity = Number(req.body.quantity ?? 1);
  if (!slug || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) return apiError(res, 400, "Sản phẩm hoặc số lượng không hợp lệ.");
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const productResult = await new sql.Request(transaction)
      .input("Slug", sql.NVarChar(100), slug)
      .query("SELECT ProductId, StockQuantity FROM dbo.Products WITH (UPDLOCK, HOLDLOCK) WHERE Slug = @Slug AND IsActive = 1;");
    const product = productResult.recordset[0];
    if (!product) {
      await transaction.rollback();
      return apiError(res, 404, "Không tìm thấy sản phẩm.");
    }
    const cartId = await getCartId(req.session.userId, transaction);
    const itemResult = await new sql.Request(transaction)
      .input("CartId", sql.BigInt, cartId)
      .input("ProductId", sql.Int, product.ProductId)
      .query("SELECT Quantity FROM dbo.CartItems WITH (UPDLOCK, HOLDLOCK) WHERE CartId = @CartId AND ProductId = @ProductId;");
    const nextQuantity = Number(itemResult.recordset[0]?.Quantity || 0) + quantity;
    if (nextQuantity > product.StockQuantity) {
      await transaction.rollback();
      return apiError(res, 409, "Số lượng vượt quá tồn kho hiện tại.");
    }
    const upsert = new sql.Request(transaction)
      .input("CartId", sql.BigInt, cartId)
      .input("ProductId", sql.Int, product.ProductId)
      .input("Quantity", sql.Int, nextQuantity);
    await upsert.query(`
      IF EXISTS (SELECT 1 FROM dbo.CartItems WHERE CartId = @CartId AND ProductId = @ProductId)
        UPDATE dbo.CartItems SET Quantity = @Quantity WHERE CartId = @CartId AND ProductId = @ProductId;
      ELSE
        INSERT INTO dbo.CartItems (CartId, ProductId, Quantity) VALUES (@CartId, @ProductId, @Quantity);
    `);
    await transaction.commit();
    res.status(201).json(await readCart(req.session.userId));
  } catch (error) {
    if (transaction._aborted !== true) await transaction.rollback().catch(() => {});
    next(error);
  }
});

app.put("/api/cart/items/:slug", requireAuth, async (req, res, next) => {
  const quantity = Number(req.body.quantity);
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99) return apiError(res, 400, "Số lượng phải từ 0 đến 99.");
  try {
    const cartId = await getCartId(req.session.userId, pool);
    const productResult = await pool.request()
      .input("Slug", sql.NVarChar(100), req.params.slug)
      .query("SELECT ProductId, StockQuantity FROM dbo.Products WHERE Slug = @Slug AND IsActive = 1;");
    const product = productResult.recordset[0];
    if (!product) return apiError(res, 404, "Không tìm thấy sản phẩm.");
    if (quantity > product.StockQuantity) return apiError(res, 409, "Số lượng vượt quá tồn kho hiện tại.");
    const request = pool.request()
      .input("CartId", sql.BigInt, cartId)
      .input("ProductId", sql.Int, product.ProductId)
      .input("Quantity", sql.Int, quantity);
    if (quantity === 0) await request.query("DELETE FROM dbo.CartItems WHERE CartId = @CartId AND ProductId = @ProductId;");
    else await request.query("UPDATE dbo.CartItems SET Quantity = @Quantity WHERE CartId = @CartId AND ProductId = @ProductId;");
    res.json(await readCart(req.session.userId));
  } catch (error) { next(error); }
});

app.delete("/api/cart/items/:slug", requireAuth, async (req, res, next) => {
  try {
    const cartId = await getCartId(req.session.userId, pool);
    await pool.request()
      .input("CartId", sql.BigInt, cartId)
      .input("Slug", sql.NVarChar(100), req.params.slug)
      .query("DELETE ci FROM dbo.CartItems AS ci INNER JOIN dbo.Products AS p ON p.ProductId = ci.ProductId WHERE ci.CartId = @CartId AND p.Slug = @Slug;");
    res.json(await readCart(req.session.userId));
  } catch (error) { next(error); }
});

app.delete("/api/cart", requireAuth, async (req, res, next) => {
  try {
    const cartId = await getCartId(req.session.userId, pool);
    await pool.request().input("CartId", sql.BigInt, cartId).query("DELETE FROM dbo.CartItems WHERE CartId = @CartId;");
    res.json(await readCart(req.session.userId));
  } catch (error) { next(error); }
});

app.post("/api/orders", requireAuth, async (req, res, next) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const phone = String(req.body.phone || "").trim();
  const address = String(req.body.address || "").trim();
  const city = String(req.body.city || "").trim();
  const paymentMethod = String(req.body.paymentMethod || "cod");
  const note = String(req.body.note || "").trim();
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !phone || !address || !city) return apiError(res, 400, "Vui lòng nhập đủ tên, email, số điện thoại và địa chỉ giao hàng.");
  if (name.length > 160 || email.length > 254 || phone.length > 30 || address.length > 500 || city.length > 120 || note.length > 1000) return apiError(res, 400, "Một hoặc nhiều trường vượt quá độ dài cho phép.");
  if (!["cod", "bank_transfer", "online"].includes(paymentMethod)) return apiError(res, 400, "Phương thức thanh toán không hợp lệ.");
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const cartId = await getCartId(req.session.userId, transaction);
    const cartResult = await new sql.Request(transaction)
      .input("CartId", sql.BigInt, cartId)
      .query(`
        SELECT p.ProductId, p.Slug, p.Name, p.Price, p.StockQuantity, ci.Quantity
        FROM dbo.CartItems AS ci WITH (UPDLOCK, HOLDLOCK)
        INNER JOIN dbo.Products AS p ON p.ProductId = ci.ProductId
        WHERE ci.CartId = @CartId AND p.IsActive = 1;
      `);
    const items = cartResult.recordset;
    if (!items.length) {
      await transaction.rollback();
      return apiError(res, 400, "Giỏ hàng đang trống.");
    }
    for (const item of items) {
      if (item.Quantity > item.StockQuantity) {
        await transaction.rollback();
        return apiError(res, 409, `Số lượng ${item.Name} hiện không đủ trong kho.`);
      }
    }
    const subtotal = items.reduce((sum, item) => sum + Number(item.Price) * item.Quantity, 0);
    const orderNumber = `XG-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const orderInsert = await new sql.Request(transaction)
      .input("OrderNumber", sql.NVarChar(32), orderNumber)
      .input("UserId", sql.Int, req.session.userId)
      .input("CustomerName", sql.NVarChar(160), name)
      .input("CustomerEmail", sql.NVarChar(254), email)
      .input("CustomerPhone", sql.NVarChar(30), phone)
      .input("ShippingAddress", sql.NVarChar(500), address)
      .input("Ward", sql.NVarChar(120), req.body.ward ? String(req.body.ward).slice(0, 120) : null)
      .input("District", sql.NVarChar(120), req.body.district ? String(req.body.district).slice(0, 120) : null)
      .input("City", sql.NVarChar(120), city.slice(0, 120))
      .input("Subtotal", sql.Decimal(18, 2), subtotal)
      .input("TotalAmount", sql.Decimal(18, 2), subtotal)
      .input("PaymentMethod", sql.NVarChar(24), paymentMethod)
      .input("CustomerNote", sql.NVarChar(1000), note ? note.slice(0, 1000) : null)
      .query(`
        INSERT INTO dbo.Orders
          (OrderNumber, UserId, CustomerName, CustomerEmail, CustomerPhone,
           ShippingAddress, ShippingWard, ShippingDistrict, ShippingCity,
           Subtotal, TotalAmount, PaymentMethod, CustomerNote)
        OUTPUT inserted.OrderId, inserted.OrderNumber, inserted.TotalAmount,
               inserted.OrderStatus, inserted.CreatedAt
        VALUES
          (@OrderNumber, @UserId, @CustomerName, @CustomerEmail, @CustomerPhone,
           @ShippingAddress, @Ward, @District, @City,
           @Subtotal, @TotalAmount, @PaymentMethod, @CustomerNote);
      `);
    const order = orderInsert.recordset[0];
    for (const item of items) {
      const updateStock = await new sql.Request(transaction)
        .input("ProductId", sql.Int, item.ProductId)
        .input("Quantity", sql.Int, item.Quantity)
        .query(`
          UPDATE dbo.Products SET StockQuantity = StockQuantity - @Quantity, UpdatedAt = SYSUTCDATETIME()
          WHERE ProductId = @ProductId AND StockQuantity >= @Quantity;
          SELECT @@ROWCOUNT AS RowsAffected;
        `);
      if (updateStock.recordset[0].RowsAffected !== 1) throw Object.assign(new Error(`Tồn kho ${item.Name} vừa thay đổi.`), { status: 409 });
      await new sql.Request(transaction)
        .input("OrderId", sql.BigInt, order.OrderId)
        .input("ProductId", sql.Int, item.ProductId)
        .input("ProductName", sql.NVarChar(180), item.Name)
        .input("ProductSlug", sql.NVarChar(100), item.Slug)
        .input("UnitPrice", sql.Decimal(18, 2), item.Price)
        .input("Quantity", sql.Int, item.Quantity)
        .query(`
          INSERT INTO dbo.OrderItems (OrderId, ProductId, ProductName, ProductSlug, UnitPrice, Quantity)
          VALUES (@OrderId, @ProductId, @ProductName, @ProductSlug, @UnitPrice, @Quantity);
        `);
    }
    await new sql.Request(transaction).input("CartId", sql.BigInt, cartId).query("UPDATE dbo.Carts SET IsActive = 0, UpdatedAt = SYSUTCDATETIME() WHERE CartId = @CartId;");
    await transaction.commit();
    res.status(201).json({
      order: {
        id: order.OrderId,
        number: order.OrderNumber,
        total: Number(order.TotalAmount),
        status: order.OrderStatus,
      },
      receipt: {
        number: order.OrderNumber,
        createdAt: order.CreatedAt,
        customer: { name, email, phone },
        shippingAddress: {
          address,
          ward: req.body.ward ? String(req.body.ward).slice(0, 120) : "",
          district: req.body.district ? String(req.body.district).slice(0, 120) : "",
          city: city.slice(0, 120),
        },
        paymentMethod,
        note: note ? note.slice(0, 1000) : "",
        subtotal: Number(order.TotalAmount),
        shippingFee: 0,
        discount: 0,
        total: Number(order.TotalAmount),
        items: items.map(item => ({
          name: item.Name,
          slug: item.Slug,
          unitPrice: Number(item.Price),
          quantity: Number(item.Quantity),
          total: Number(item.Price) * Number(item.Quantity),
        })),
      },
    });
  } catch (error) {
    if (transaction._aborted !== true) await transaction.rollback().catch(() => {});
    next(error);
  }
});

app.get("/api/orders", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.request()
      .input("UserId", sql.Int, req.session.userId)
      .query(`
        SELECT o.OrderId AS id, o.OrderNumber AS number,
               o.CustomerName AS customerName, o.CustomerEmail AS customerEmail,
               o.CustomerPhone AS customerPhone, o.ShippingAddress AS shippingAddress,
               o.ShippingWard AS ward, o.ShippingDistrict AS district,
               o.ShippingCity AS city, o.Subtotal AS subtotal,
               o.ShippingFee AS shippingFee, o.DiscountAmount AS discount,
               o.TotalAmount AS total, o.OrderStatus AS status,
               o.PaymentMethod AS paymentMethod, o.PaymentStatus AS paymentStatus,
               o.CustomerNote AS note, o.CreatedAt AS createdAt,
               oi.ProductName AS productName, oi.ProductSlug AS productSlug,
               oi.UnitPrice AS unitPrice, oi.Quantity AS quantity, oi.LineTotal AS lineTotal
        FROM dbo.Orders AS o
        LEFT JOIN dbo.OrderItems AS oi ON oi.OrderId = o.OrderId
        WHERE o.UserId = @UserId
        ORDER BY o.CreatedAt DESC, o.OrderId DESC;
      `);
    const orders = new Map();
    for (const row of result.recordset) {
      let order = orders.get(row.id);
      if (!order) {
        order = {
          id: row.id,
          number: row.number,
          customerName: row.customerName,
          customerEmail: row.customerEmail,
          customerPhone: row.customerPhone,
          shippingAddress: [row.shippingAddress, row.ward, row.district, row.city].filter(Boolean).join(", "),
          subtotal: Number(row.subtotal),
          shippingFee: Number(row.shippingFee),
          discount: Number(row.discount),
          total: Number(row.total),
          status: row.status,
          paymentMethod: row.paymentMethod,
          paymentStatus: row.paymentStatus,
          note: row.note,
          createdAt: row.createdAt,
          items: [],
        };
        orders.set(row.id, order);
      }
      if (row.productName) {
        order.items.push({
          name: row.productName,
          slug: row.productSlug,
          unitPrice: Number(row.unitPrice),
          quantity: Number(row.quantity),
          total: Number(row.lineTotal),
        });
      }
    }
    res.json([...orders.values()]);
  } catch (error) { next(error); }
});

app.post("/api/wishlist/:slug", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.request()
      .input("UserId", sql.Int, req.session.userId)
      .input("Slug", sql.NVarChar(100), req.params.slug)
      .query(`
        INSERT INTO dbo.Wishlists (UserId, ProductId)
        SELECT @UserId, ProductId FROM dbo.Products WHERE Slug = @Slug AND IsActive = 1
          AND NOT EXISTS (
            SELECT 1 FROM dbo.Wishlists w INNER JOIN dbo.Products p ON p.ProductId = w.ProductId
            WHERE w.UserId = @UserId AND p.Slug = @Slug
          );
        SELECT @@ROWCOUNT AS Added;
      `);
    if (result.recordset[0].Added === 0) return apiError(res, 404, "Sản phẩm không tồn tại hoặc đã có trong danh sách yêu thích.");
    res.status(201).json({ ok: true });
  } catch (error) { next(error); }
});

app.delete("/api/wishlist/:slug", requireAuth, async (req, res, next) => {
  try {
    await pool.request()
      .input("UserId", sql.Int, req.session.userId)
      .input("Slug", sql.NVarChar(100), req.params.slug)
      .query(`DELETE w FROM dbo.Wishlists w INNER JOIN dbo.Products p ON p.ProductId = w.ProductId WHERE w.UserId = @UserId AND p.Slug = @Slug;`);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

function validateAdminProduct(body) {
  body = body || {};
  const product = {
    slug: String(body.slug || "").trim().toLowerCase(),
    category: String(body.category || "").trim(),
    name: String(body.name || "").trim(),
    description: String(body.description || "").trim(),
    spec: String(body.spec || "").trim(),
    detail: String(body.detail || "").trim(),
    image: String(body.image || "").trim(),
    tag: String(body.tag || "").trim(),
    price: Number(body.price),
    oldPrice: body.oldPrice === "" || body.oldPrice == null ? null : Number(body.oldPrice),
    stock: Number(body.stock),
    hot: body.hot === true,
    active: body.active !== false,
  };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product.slug) || product.slug.length > 100) {
    return { error: "Slug chỉ gồm chữ thường, số và dấu gạch ngang." };
  }
  if (!product.category || product.name.length < 2 || product.name.length > 180) {
    return { error: "Vui lòng chọn danh mục và nhập tên sản phẩm hợp lệ." };
  }
  if (!product.description || product.description.length > 500 || !product.spec || product.spec.length > 1000) {
    return { error: "Mô tả ngắn (tối đa 500) và thông số (tối đa 1000) là bắt buộc." };
  }
  if (!product.detail || product.detail.length > 1000 || product.image.length > 500 || !product.image) {
    return { error: "Chi tiết (tối đa 1000) và đường dẫn ảnh (tối đa 500) là bắt buộc." };
  }
  if (!/^(images\/|https:\/\/)/i.test(product.image)) {
    return { error: "Ảnh phải nằm trong thư mục images/ hoặc dùng URL HTTPS." };
  }
  if (product.tag.length > 80 || !Number.isFinite(product.price) || product.price < 0 || product.price > 9999999999999999) {
    return { error: "Nhãn hoặc giá bán không hợp lệ." };
  }
  if (product.oldPrice !== null && (!Number.isFinite(product.oldPrice) || product.oldPrice < product.price || product.oldPrice > 9999999999999999)) {
    return { error: "Giá so sánh phải lớn hơn hoặc bằng giá bán." };
  }
  if (!Number.isInteger(product.stock) || product.stock < 0 || product.stock > 2147483647) {
    return { error: "Tồn kho phải là số nguyên không âm." };
  }
  return { product };
}

app.get("/api/admin/summary", requireAdmin, async (req, res, next) => {
  try {
    const [products, orders, users] = await Promise.all([
      pool.request().query(`
        SELECT COUNT(*) AS productCount,
               COALESCE(SUM(StockQuantity), 0) AS stockUnits,
               SUM(CASE WHEN StockQuantity = 0 THEN 1 ELSE 0 END) AS outOfStockCount,
               SUM(CASE WHEN StockQuantity BETWEEN 1 AND 5 THEN 1 ELSE 0 END) AS lowStockCount
        FROM dbo.Products WHERE IsActive = 1;
      `),
      pool.request().query(`
        SELECT COUNT(*) AS orderCount,
               SUM(CASE WHEN OrderStatus = N'pending' THEN 1 ELSE 0 END) AS pendingCount,
               COALESCE(SUM(CASE WHEN OrderStatus = N'completed' THEN TotalAmount ELSE 0 END), 0) AS completedRevenue
        FROM dbo.Orders;
      `),
      pool.request().query(`
        SELECT COUNT(*) AS userCount,
               SUM(CASE WHEN IsActive = 1 AND Role = N'customer' THEN 1 ELSE 0 END) AS activeCustomerCount
        FROM dbo.Users;
      `),
    ]);
    res.json({
      products: products.recordset[0],
      orders: orders.recordset[0],
      users: users.recordset[0],
    });
  } catch (error) { next(error); }
});

app.get("/api/admin/products", requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.request().query(`
      SELECT p.ProductId AS id, p.Slug AS slug, c.Slug AS category,
             c.Name AS categoryName, p.Name AS name,
             p.ShortDescription AS description, p.Specifications AS spec,
             p.Detail AS detail, p.ImageUrl AS image, p.Badge AS tag,
             p.Price AS price, p.CompareAtPrice AS oldPrice,
             p.StockQuantity AS stock,
             COALESCE((
               SELECT SUM(oi.Quantity)
               FROM dbo.OrderItems AS oi
               INNER JOIN dbo.Orders AS o ON o.OrderId = oi.OrderId
               WHERE oi.ProductId = p.ProductId AND o.OrderStatus <> N'cancelled'
             ), 0) AS sold,
             p.IsFeatured AS hot, p.IsActive AS active
      FROM dbo.Products AS p
      INNER JOIN dbo.Categories AS c ON c.CategoryId = p.CategoryId
      ORDER BY p.IsActive DESC, p.Name;
    `);
    res.json(result.recordset.map(product => ({
      ...product,
      price: Number(product.price),
      oldPrice: product.oldPrice == null ? null : Number(product.oldPrice),
      stock: Number(product.stock),
      sold: Number(product.sold),
      hot: Boolean(product.hot),
      active: Boolean(product.active),
    })));
  } catch (error) { next(error); }
});

app.post("/api/admin/products", requireAdmin, async (req, res, next) => {
  const validated = validateAdminProduct(req.body);
  if (validated.error) return apiError(res, 400, validated.error);
  const product = validated.product;
  try {
    const result = await pool.request()
      .input("Slug", sql.NVarChar(100), product.slug)
      .input("CategorySlug", sql.NVarChar(80), product.category)
      .input("Name", sql.NVarChar(180), product.name)
      .input("ShortDescription", sql.NVarChar(500), product.description)
      .input("Specifications", sql.NVarChar(1000), product.spec)
      .input("Detail", sql.NVarChar(1000), product.detail)
      .input("ImageUrl", sql.NVarChar(500), product.image)
      .input("Badge", sql.NVarChar(80), product.tag || null)
      .input("Price", sql.Decimal(18, 2), product.price)
      .input("CompareAtPrice", sql.Decimal(18, 2), product.oldPrice)
      .input("StockQuantity", sql.Int, product.stock)
      .input("IsFeatured", sql.Bit, product.hot)
      .input("IsActive", sql.Bit, product.active)
      .query(`
        INSERT INTO dbo.Products
          (Slug, CategoryId, Name, ShortDescription, Specifications, Detail,
           ImageUrl, Badge, Price, CompareAtPrice, StockQuantity, IsFeatured, IsActive)
        OUTPUT inserted.ProductId AS id, inserted.Slug AS slug
        SELECT @Slug, CategoryId, @Name, @ShortDescription, @Specifications, @Detail,
               @ImageUrl, @Badge, @Price, @CompareAtPrice, @StockQuantity, @IsFeatured, @IsActive
        FROM dbo.Categories WHERE Slug = @CategorySlug AND IsActive = 1;
      `);
    if (!result.recordset.length) return apiError(res, 400, "Danh mục không tồn tại hoặc đang bị ẩn.");
    res.status(201).json({ product: result.recordset[0] });
  } catch (error) {
    if (error.number === 2627 || error.number === 2601) return apiError(res, 409, "Slug sản phẩm đã tồn tại.");
    next(error);
  }
});

app.put("/api/admin/products/:id", requireAdmin, async (req, res, next) => {
  const productId = Number(req.params.id);
  if (!Number.isInteger(productId) || productId < 1) return apiError(res, 400, "Mã sản phẩm không hợp lệ.");
  const validated = validateAdminProduct(req.body);
  if (validated.error) return apiError(res, 400, validated.error);
  const product = validated.product;
  try {
    const result = await pool.request()
      .input("ProductId", sql.Int, productId)
      .input("Slug", sql.NVarChar(100), product.slug)
      .input("CategorySlug", sql.NVarChar(80), product.category)
      .input("Name", sql.NVarChar(180), product.name)
      .input("ShortDescription", sql.NVarChar(500), product.description)
      .input("Specifications", sql.NVarChar(1000), product.spec)
      .input("Detail", sql.NVarChar(1000), product.detail)
      .input("ImageUrl", sql.NVarChar(500), product.image)
      .input("Badge", sql.NVarChar(80), product.tag || null)
      .input("Price", sql.Decimal(18, 2), product.price)
      .input("CompareAtPrice", sql.Decimal(18, 2), product.oldPrice)
      .input("StockQuantity", sql.Int, product.stock)
      .input("IsFeatured", sql.Bit, product.hot)
      .input("IsActive", sql.Bit, product.active)
      .query(`
        UPDATE p
        SET Slug = @Slug, CategoryId = c.CategoryId, Name = @Name,
            ShortDescription = @ShortDescription, Specifications = @Specifications,
            Detail = @Detail, ImageUrl = @ImageUrl, Badge = @Badge,
            Price = @Price, CompareAtPrice = @CompareAtPrice,
            StockQuantity = @StockQuantity, IsFeatured = @IsFeatured,
            IsActive = @IsActive, UpdatedAt = SYSUTCDATETIME()
        OUTPUT inserted.ProductId AS id, inserted.Slug AS slug
        FROM dbo.Products AS p
        INNER JOIN dbo.Categories AS c ON c.Slug = @CategorySlug AND c.IsActive = 1
        WHERE p.ProductId = @ProductId;
      `);
    if (!result.recordset.length) return apiError(res, 404, "Không tìm thấy sản phẩm hoặc danh mục.");
    res.json({ product: result.recordset[0] });
  } catch (error) {
    if (error.number === 2627 || error.number === 2601) return apiError(res, 409, "Slug sản phẩm đã tồn tại.");
    next(error);
  }
});

app.delete("/api/admin/products/:id", requireAdmin, async (req, res, next) => {
  const productId = Number(req.params.id);
  if (!Number.isInteger(productId) || productId < 1) return apiError(res, 400, "Mã sản phẩm không hợp lệ.");
  try {
    const result = await pool.request()
      .input("ProductId", sql.Int, productId)
      .query(`
        UPDATE dbo.Products SET IsActive = 0, UpdatedAt = SYSUTCDATETIME()
        WHERE ProductId = @ProductId AND IsActive = 1;
        SELECT @@ROWCOUNT AS affected;
      `);
    if (!result.recordset[0].affected) return apiError(res, 404, "Không tìm thấy sản phẩm đang bán.");
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.get("/api/admin/orders", requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.request().query(`
      SELECT o.OrderId AS id, o.OrderNumber AS number, o.UserId AS userId,
             o.CustomerName AS customerName, o.CustomerEmail AS customerEmail,
             o.CustomerPhone AS customerPhone, o.ShippingAddress AS shippingAddress,
             o.ShippingWard AS ward, o.ShippingDistrict AS district,
             o.ShippingCity AS city, o.TotalAmount AS total,
             o.OrderStatus AS status, o.PaymentMethod AS paymentMethod,
             o.PaymentStatus AS paymentStatus, o.CustomerNote AS note,
             o.CreatedAt AS createdAt,
             oi.ProductName AS productName, oi.ProductSlug AS productSlug,
             oi.UnitPrice AS unitPrice, oi.Quantity AS quantity, oi.LineTotal AS lineTotal
      FROM dbo.Orders AS o
      LEFT JOIN dbo.OrderItems AS oi ON oi.OrderId = o.OrderId
      ORDER BY o.CreatedAt DESC, o.OrderId DESC;
    `);
    const orders = new Map();
    for (const row of result.recordset) {
      let order = orders.get(row.id);
      if (!order) {
        order = {
          id: row.id,
          number: row.number,
          userId: row.userId,
          customerName: row.customerName,
          customerEmail: row.customerEmail,
          customerPhone: row.customerPhone,
          shippingAddress: [row.shippingAddress, row.ward, row.district, row.city].filter(Boolean).join(", "),
          total: Number(row.total),
          status: row.status,
          paymentMethod: row.paymentMethod,
          paymentStatus: row.paymentStatus,
          note: row.note,
          createdAt: row.createdAt,
          items: [],
        };
        orders.set(row.id, order);
      }
      if (row.productName) {
        order.items.push({
          name: row.productName,
          slug: row.productSlug,
          unitPrice: Number(row.unitPrice),
          quantity: Number(row.quantity),
          total: Number(row.lineTotal),
        });
      }
    }
    res.json([...orders.values()]);
  } catch (error) { next(error); }
});

app.put("/api/admin/orders/:id", requireAdmin, async (req, res, next) => {
  const orderId = Number(req.params.id);
  const body = req.body || {};
  const orderStatus = String(body.status || "");
  const paymentStatus = String(body.paymentStatus || "");
  if (!Number.isInteger(orderId) || orderId < 1) return apiError(res, 400, "Mã đơn hàng không hợp lệ.");
  if (!["pending", "confirmed", "shipping", "completed", "cancelled"].includes(orderStatus)) return apiError(res, 400, "Trạng thái đơn hàng không hợp lệ.");
  if (!["unpaid", "pending", "paid", "refunded", "failed"].includes(paymentStatus)) return apiError(res, 400, "Trạng thái thanh toán không hợp lệ.");
  const transaction = new sql.Transaction(pool);
  let transactionOpen = false;
  try {
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    transactionOpen = true;
    const currentResult = await new sql.Request(transaction)
      .input("OrderId", sql.BigInt, orderId)
      .query("SELECT OrderStatus FROM dbo.Orders WITH (UPDLOCK, HOLDLOCK) WHERE OrderId = @OrderId;");
    const current = currentResult.recordset[0];
    if (!current) {
      await transaction.rollback();
      transactionOpen = false;
      return apiError(res, 404, "Không tìm thấy đơn hàng.");
    }
    if (current.OrderStatus === "cancelled" && orderStatus !== "cancelled") {
      await transaction.rollback();
      transactionOpen = false;
      return apiError(res, 409, "Đơn đã hủy không thể mở lại.");
    }
    if (orderStatus === "cancelled" && !["pending", "confirmed", "cancelled"].includes(current.OrderStatus)) {
      await transaction.rollback();
      transactionOpen = false;
      return apiError(res, 409, "Chỉ có thể hủy đơn đang chờ xác nhận hoặc đã xác nhận.");
    }
    if (orderStatus === "cancelled" && paymentStatus === "paid") {
      await transaction.rollback();
      transactionOpen = false;
      return apiError(res, 409, "Đơn đã hủy không thể giữ trạng thái đã thanh toán; hãy chọn Đã hoàn tiền nếu đã hoàn tiền.");
    }
    if (orderStatus === "cancelled" && current.OrderStatus !== "cancelled") {
      await new sql.Request(transaction)
        .input("OrderId", sql.BigInt, orderId)
        .query(`
          UPDATE p
          SET StockQuantity = p.StockQuantity + items.Quantity,
              UpdatedAt = SYSUTCDATETIME()
          FROM dbo.Products AS p
          INNER JOIN (
            SELECT ProductId, SUM(Quantity) AS Quantity
            FROM dbo.OrderItems
            WHERE OrderId = @OrderId AND ProductId IS NOT NULL
            GROUP BY ProductId
          ) AS items ON items.ProductId = p.ProductId;
        `);
    }
    const updateResult = await new sql.Request(transaction)
      .input("OrderId", sql.BigInt, orderId)
      .input("OrderStatus", sql.NVarChar(24), orderStatus)
      .input("PaymentStatus", sql.NVarChar(24), paymentStatus)
      .query(`
        UPDATE dbo.Orders
        SET OrderStatus = @OrderStatus,
            PaymentStatus = @PaymentStatus,
            UpdatedAt = SYSUTCDATETIME()
        OUTPUT inserted.OrderNumber AS number, inserted.OrderStatus AS status,
               inserted.PaymentStatus AS paymentStatus
        WHERE OrderId = @OrderId;
      `);
    await transaction.commit();
    transactionOpen = false;
    res.json({ order: updateResult.recordset[0] });
  } catch (error) {
    if (transactionOpen) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        console.error("Không thể rollback cập nhật đơn hàng:", rollbackError.message);
      }
    }
    next(error);
  }
});

app.get("/api/admin/users", requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.request().query(`
      SELECT UserId AS id, FullName AS name, Email AS email, Phone AS phone,
             Address AS address, Role AS role, IsActive AS active, CreatedAt AS createdAt
      FROM dbo.Users
      ORDER BY Role DESC, IsActive DESC, CreatedAt DESC;
    `);
    res.json(result.recordset.map(user => ({ ...user, active: Boolean(user.active) })));
  } catch (error) { next(error); }
});

app.put("/api/admin/users/:id/active", requireAdmin, async (req, res, next) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId < 1) return apiError(res, 400, "Mã người dùng không hợp lệ.");
  const active = req.body && req.body.active;
  if (typeof active !== "boolean") return apiError(res, 400, "Trạng thái tài khoản không hợp lệ.");
  if (userId === req.session.userId && !active) return apiError(res, 400, "Bạn không thể tự vô hiệu hóa tài khoản đang đăng nhập.");
  try {
    const result = await pool.request()
      .input("UserId", sql.Int, userId)
      .input("IsActive", sql.Bit, active)
      .query(`
        UPDATE dbo.Users
        SET IsActive = @IsActive, UpdatedAt = SYSUTCDATETIME()
        OUTPUT inserted.UserId AS id, inserted.IsActive AS active
        WHERE UserId = @UserId AND Role = N'customer';
      `);
    if (!result.recordset.length) return apiError(res, 404, "Không tìm thấy tài khoản khách hàng.");
    res.json({ user: { ...result.recordset[0], active: Boolean(result.recordset[0].active) } });
  } catch (error) { next(error); }
});

app.use("/api", (req, res) => apiError(res, 404, "API endpoint không tồn tại."));

app.use((req, res, next) => {
  const blocked = new Set(["/server.js", "/package.json", "/package-lock.json"]);
  if (blocked.has(req.path) || req.path.startsWith("/node_modules/") || /\.(?:env|sql|ps1|md)$/i.test(req.path)) {
    return res.sendStatus(404);
  }
  next();
});
app.use(express.static(root, { dotfiles: "deny", index: "index.html", fallthrough: true }));

app.use((error, req, res, next) => {
  console.error("API error:", error.message);
  if (res.headersSent) return next(error);
  if (error.status) return apiError(res, error.status, error.message);
  if (error.number === 547) return apiError(res, 409, "Dữ liệu liên quan đã thay đổi. Vui lòng tải lại rồi thử lại.");
  if (error.code === "EREQUEST" && error.number === 2627) return apiError(res, 409, "Dữ liệu đã tồn tại.");
  apiError(res, 500, "Có lỗi máy chủ. Hãy xem thông báo lỗi trong cửa sổ terminal.");
});

async function start() {
  await pool.connect();
  const db = await pool.request().query("SELECT DB_NAME() AS databaseName, SUSER_SNAME() AS loginName;");
  app.listen(port, () => {
    console.log(`XUNG API + website: http://localhost:${port}`);
    console.log(`SQL Server: ${sqlServer} / ${db.recordset[0].databaseName} (${db.recordset[0].loginName})`);
  });
}

start().catch(async error => {
  console.error("Không thể khởi động API hoặc kết nối SQL Server:", error.message);
  console.error("Kiểm tra SQL_SERVER, SQL_DATABASE, SQL_DRIVER và quyền của tài khoản Windows đang chạy Node.");
  await pool.close().catch(() => {});
  process.exitCode = 1;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await pool.close().catch(() => {});
    process.exit(0);
  });
}
