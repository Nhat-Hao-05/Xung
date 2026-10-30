function setAuthMode(mode) {
  const login = mode === "login";
  document.querySelectorAll("[data-auth-mode]").forEach(button => {
    if (!button.matches(".auth-tab")) return;
    const active = button.dataset.authMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-auth-form]").forEach(form => {
    form.hidden = form.dataset.authForm !== mode;
  });
  const heading = document.getElementById("authHeading");
  const intro = document.getElementById("authIntro");
  const message = document.getElementById("authMessage");
  if (heading) heading.textContent = login ? "Đăng nhập" : "Tạo tài khoản";
  if (intro) intro.textContent = login
    ? "Trở lại với những lựa chọn công nghệ của bạn."
    : "Tạo tài khoản XUNG để bắt đầu hành trình của bạn.";
  if (message) {
    message.textContent = "";
    message.classList.remove("error");
  }
}

let accountOrdersRequest = 0;

async function loadAccountOrders() {
  const ordersRoot = document.getElementById("accountOrders");
  if (!ordersRoot) return;
  const requestId = ++accountOrdersRequest;
  const refreshButton = document.getElementById("refreshOrdersButton");
  ordersRoot.setAttribute("aria-busy", "true");
  if (refreshButton) refreshButton.disabled = true;
  try {
    const orders = await XungAPI.get("/api/orders");
    if (requestId !== accountOrdersRequest) return;
    if (!orders.length) {
      ordersRoot.innerHTML = '<p class="account-orders-state">Bạn chưa có đơn hàng nào. Đơn đã đặt sẽ xuất hiện tại đây.</p>';
      return;
    }
    const statusLabels = {
      pending: "Chờ xác nhận",
      confirmed: "Đã xác nhận",
      shipping: "Đang giao hàng",
      completed: "Đã giao",
      cancelled: "Đã hủy",
    };
    const paymentLabels = {
      cod: "Thanh toán khi nhận hàng",
      bank_transfer: "Chuyển khoản",
      online: "Thanh toán trực tuyến",
    };
    const paymentStatusLabels = {
      unpaid: "Chưa thanh toán",
      pending: "Đang xử lý thanh toán",
      paid: "Đã thanh toán",
      refunded: "Đã hoàn tiền",
      failed: "Thanh toán thất bại",
    };
    const stages = ["pending", "confirmed", "shipping", "completed"];
    ordersRoot.innerHTML = orders.map(order => {
      const currentStage = stages.indexOf(order.status);
      const progress = order.status === "cancelled"
        ? '<p class="account-order-cancelled">Đơn hàng đã bị hủy.</p>'
        : `<ol class="account-order-progress" aria-label="Tiến độ đơn hàng">${stages.map((stage, index) => {
          const state = index < currentStage ? "done" : index === currentStage ? "current" : "";
          return `<li class="${state}"><span></span><small>${statusLabels[stage]}</small></li>`;
        }).join("")}</ol>`;
      const items = (order.items || []).map(item => `
        <li><span>${XungAPI.escapeHtml(item.name)} × ${Number(item.quantity)}</span><strong>${XungAPI.formatPrice(item.total)}</strong></li>
      `).join("");
      const date = new Date(order.createdAt);
      const displayDate = Number.isNaN(date.getTime()) ? "" : date.toLocaleString("vi-VN");
      return `
        <article class="account-order">
          <header class="account-order-header">
            <div><span class="account-order-label">Mã đơn hàng</span><strong>${XungAPI.escapeHtml(order.number)}</strong></div>
            <span class="account-order-status ${order.status === "cancelled" ? "cancelled" : ""}">${statusLabels[order.status] || XungAPI.escapeHtml(order.status)}</span>
          </header>
          <p class="account-order-date">${XungAPI.escapeHtml(displayDate)}</p>
          ${progress}
          <details class="account-order-details">
            <summary>Xem chi tiết đơn hàng</summary>
            <ul class="account-order-items">${items}</ul>
            <div class="account-order-shipping">
              <span>Người nhận: ${XungAPI.escapeHtml(order.customerName)}</span>
              <span>Điện thoại: ${XungAPI.escapeHtml(order.customerPhone)}</span>
              <span>Địa chỉ: ${XungAPI.escapeHtml(order.shippingAddress)}</span>
              <span>Thanh toán: ${paymentLabels[order.paymentMethod] || XungAPI.escapeHtml(order.paymentMethod)} (${paymentStatusLabels[order.paymentStatus] || XungAPI.escapeHtml(order.paymentStatus)})</span>
            </div>
            <div class="account-order-total"><span>Tổng cộng</span><strong>${XungAPI.formatPrice(order.total)}</strong></div>
          </details>
        </article>
      `;
    }).join("");
  } catch (error) {
    if (requestId !== accountOrdersRequest) return;
    ordersRoot.innerHTML = `<p class="account-orders-state error">Không tải được đơn hàng: ${XungAPI.escapeHtml(error.message)}</p>`;
  } finally {
    if (requestId === accountOrdersRequest) {
      ordersRoot.removeAttribute("aria-busy");
      if (refreshButton) refreshButton.disabled = false;
    }
  }
}

function renderAuthState(user) {
  const nav = document.querySelector(".nav");
  if (nav) {
    let adminLink = nav.querySelector("[data-admin-link]");
    if (user && user.role === "admin") {
      if (!adminLink) {
        adminLink = document.createElement("a");
        adminLink.href = "admin.html";
        adminLink.dataset.adminLink = "";
        adminLink.textContent = "Quản trị";
        const pledge = nav.querySelector(".pledge");
        nav.insertBefore(adminLink, pledge || null);
      }
    } else if (adminLink) {
      adminLink.remove();
    }
  }
  document.querySelectorAll("[data-account-link]").forEach(link => {
    const label = link.querySelector("span");
    if (label) {
      label.textContent = user ? (user.name || user.email) : "Đăng nhập";
      if (user) label.title = user.name || user.email;
      else label.removeAttribute("title");
    }
  });
  const forms = document.getElementById("accountForms");
  const signedIn = document.getElementById("accountSignedIn");
  if (!forms || !signedIn) return;
  forms.hidden = Boolean(user);
  signedIn.hidden = !user;
  if (user) {
    loadAccountOrders();
    const displayName = user.name || user.email.split("@")[0];
    const accountEmail = document.getElementById("accountEmail");
    const accountAvatar = document.getElementById("accountAvatar");
    const profileForm = document.getElementById("profileForm");
    const profileDetails = document.getElementById("profileDetails");
    if (accountEmail) accountEmail.textContent = user.email;
    if (accountAvatar) accountAvatar.textContent = displayName.trim().charAt(0).toLocaleUpperCase("vi");
    if (profileForm) {
      profileForm.elements.name.value = user.name || "";
      profileForm.elements.phone.value = user.phone || "";
      profileForm.elements.address.value = user.address || "";
      profileForm.elements.identityNumber.value = "";
      if (profileForm.elements.gender) profileForm.elements.gender.value = user.gender || "unspecified";
      profileForm.dataset.savedGender = user.gender || "unspecified";
    }
    const genderLabels = {
      male: "Nam",
      female: "Nữ",
      other: "Khác",
      unspecified: "Không muốn trả lời",
    };
    const profileValues = {
      profileName: user.name,
      profilePhone: user.phone,
      profileAddress: user.address,
      profileGender: genderLabels[user.gender] || user.gender,
      profileEmail: user.email,
      profileIdentityNumber: user.hasIdentityNumber
        ? "************"
        : "Chưa cung cấp",
    };
    Object.entries(profileValues).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value || "Chưa cập nhật";
    });
    if (profileDetails) profileDetails.hidden = false;
    if (profileForm) profileForm.hidden = true;
  }
}

const refreshOrdersButton = document.getElementById("refreshOrdersButton");
if (refreshOrdersButton) refreshOrdersButton.addEventListener("click", loadAccountOrders);

async function finishAuthentication(user) {
  renderAuthState(user);
  if (window.XungStore) await window.XungStore.refreshCartCount();
  let pendingProduct = null;
  let returnTo = null;
  try {
    pendingProduct = sessionStorage.getItem("xung-pending-cart");
    returnTo = sessionStorage.getItem("xung-return-to");
    sessionStorage.removeItem("xung-pending-cart");
    sessionStorage.removeItem("xung-return-to");
  } catch { /* Continue without restoring the guest's pending action. */ }
  if (pendingProduct) {
    try {
      await XungAPI.post("/api/cart/items", { productSlug: pendingProduct, quantity: 1 });
      if (window.XungStore) await window.XungStore.refreshCartCount();
    } catch (error) {
      const message = document.getElementById("authMessage");
      if (message) {
        message.textContent = `Đăng nhập thành công, nhưng chưa thêm được sản phẩm: ${error.message}`;
        message.classList.add("error");
      }
    }
    if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")) location.href = returnTo;
  }
}

function showAuthError(messageText) {
  const message = document.getElementById("authMessage");
  if (!message) return;
  message.textContent = messageText;
  message.classList.add("error");
}

document.querySelectorAll("[data-auth-mode]").forEach(button => {
  button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
});

const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!loginForm.reportValidity()) return;
    const values = Object.fromEntries(new FormData(loginForm));
    const submit = loginForm.querySelector("[type=submit]");
    submit.disabled = true;
    try {
      const result = await XungAPI.post("/api/auth/login", values);
      await finishAuthentication(result.user);
    } catch (error) {
      showAuthError(error.message);
    } finally {
      submit.disabled = false;
    }
  });
}

const registerForm = document.getElementById("registerForm");
if (registerForm) {
  registerForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!registerForm.reportValidity()) return;
    const values = Object.fromEntries(new FormData(registerForm));
    if (values.password !== values.confirmPassword) {
      showAuthError("Mật khẩu xác nhận chưa khớp. Vui lòng kiểm tra lại.");
      registerForm.elements.confirmPassword.focus();
      return;
    }
    const submit = registerForm.querySelector("[type=submit]");
    submit.disabled = true;
    try {
      const result = await XungAPI.post("/api/auth/register", {
        name: values.name,
        phone: values.phone,
        email: values.email,
        address: values.address,
        gender: values.gender,
        identityNumber: values.identityNumber,
        password: values.password,
      });
      await finishAuthentication(result.user);
    } catch (error) {
      showAuthError(error.message);
    } finally {
      submit.disabled = false;
    }
  });
}

const profileForm = document.getElementById("profileForm");
const profileDetails = document.getElementById("profileDetails");
const profileMessage = document.getElementById("profileMessage");
const editProfileButton = document.getElementById("editProfileButton");
const cancelProfileButton = document.getElementById("cancelProfileButton");

if (editProfileButton && profileDetails && profileForm) {
  editProfileButton.addEventListener("click", () => {
    profileDetails.hidden = true;
    profileForm.hidden = false;
    if (profileMessage) {
      profileMessage.textContent = "";
      profileMessage.hidden = true;
      profileMessage.classList.remove("error");
    }
    profileForm.elements.name.focus();
  });
}

if (cancelProfileButton && profileDetails && profileForm) {
  cancelProfileButton.addEventListener("click", () => {
    profileForm.elements.name.value = document.getElementById("profileName").textContent;
    profileForm.elements.phone.value = document.getElementById("profilePhone").textContent === "Chưa cập nhật"
      ? ""
      : document.getElementById("profilePhone").textContent;
    profileForm.elements.address.value = document.getElementById("profileAddress").textContent === "Chưa cập nhật"
      ? ""
      : document.getElementById("profileAddress").textContent;
    profileForm.elements.identityNumber.value = "";
    profileForm.elements.gender.value = profileForm.dataset.savedGender || "unspecified";
    profileDetails.hidden = false;
    profileForm.hidden = true;
    if (profileMessage) {
      profileMessage.textContent = "";
      profileMessage.hidden = true;
      profileMessage.classList.remove("error");
    }
  });
}

if (profileForm) {
  profileForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!profileForm.reportValidity()) return;
    const values = Object.fromEntries(new FormData(profileForm));
    const submit = document.getElementById("profileSaveButton");
    const message = profileMessage;
    submit.disabled = true;
    submit.firstChild.textContent = "Đang lưu... ";
    message.textContent = "Đang lưu thông tin tài khoản...";
    message.hidden = false;
    message.classList.remove("error");
    try {
      const result = await XungAPI.put("/api/auth/profile", {
        name: values.name,
        phone: values.phone,
        address: values.address,
        gender: values.gender,
        identityNumber: values.identityNumber,
      });
      renderAuthState(result.user);
      message.textContent = "Đã lưu thông tin tài khoản thành công.";
    } catch (error) {
      if (error.status === 405) {
        message.textContent = "Không kết nối được API cập nhật. Hãy mở trang tại http://localhost:3000/tai-khoan.html, không dùng Live Server cổng 5500.";
      } else if (error.status === 404) {
        message.textContent = "API đang chạy phiên bản cũ hoặc sai thư mục. Hãy dừng server bằng Ctrl+C rồi chạy npm start trong D:\\web-ban-hang\\web-ban-hang.";
      } else if (error.status === 401) {
        message.textContent = "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại rồi thử lưu.";
      } else {
        message.textContent = error.message || "Không lưu được thông tin. Hãy kiểm tra server và thử lại.";
      }
      message.classList.add("error");
    } finally {
      submit.disabled = false;
      submit.firstChild.textContent = "Lưu thay đổi ";
    }
  });
}

const logoutButton = document.getElementById("logoutButton");
if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;
    try {
      await XungAPI.post("/api/auth/logout");
      renderAuthState(null);
      setAuthMode("login");
      const message = document.getElementById("authMessage");
      if (message) message.textContent = "Bạn đã đăng xuất.";
      if (window.XungStore) await window.XungStore.refreshCartCount();
    } catch (error) {
      showAuthError(error.message);
    } finally {
      logoutButton.disabled = false;
    }
  });
}

const accountPage = document.querySelector(".account-page");
if (accountPage) {
  const requestedMode = new URLSearchParams(location.search).get("mode");
  setAuthMode(requestedMode === "register" ? "register" : "login");
}

XungAPI.get("/api/auth/me")
  .then(result => renderAuthState(result.user))
  .catch(error => {
    console.error("Không lấy được phiên đăng nhập:", error.message);
    renderAuthState(null);
  });
