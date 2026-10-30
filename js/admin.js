(() => {
  const api = window.XungAPI;
  const alertBox = document.querySelector("#adminAlert");
  const productForm = document.querySelector("#productForm");
  const productsBody = document.querySelector("#productsTable");
  const ordersBody = document.querySelector("#ordersTable");
  const inventoryBody = document.querySelector("#inventoryTable");
  const usersBody = document.querySelector("#usersTable");
  const productCategory = document.querySelector("#productCategory");
  const productFormTitle = document.querySelector("#productFormTitle");
  let products = [];
  let orders = [];
  let users = [];
  let categories = [];

  const money = value => api.formatPrice(value);
  const text = value => api.escapeHtml(value);
  const emptyRow = (colspan, message) => `<tr><td class="admin-empty" colspan="${colspan}">${text(message)}</td></tr>`;

  function showMessage(message, kind = "error") {
    alertBox.textContent = message;
    alertBox.dataset.kind = kind;
    alertBox.hidden = !message;
  }

  function clearMessage() {
    alertBox.hidden = true;
    alertBox.textContent = "";
    delete alertBox.dataset.kind;
  }

  function statusLabel(status) {
    return ({
      pending: "Chờ xác nhận",
      confirmed: "Đã xác nhận",
      shipping: "Đang giao",
      completed: "Hoàn thành",
      cancelled: "Đã hủy",
      unpaid: "Chưa thanh toán",
      paid: "Đã thanh toán",
      refunded: "Đã hoàn tiền",
      failed: "Thanh toán lỗi",
    })[status] || status;
  }

  function renderStats(summary) {
    document.querySelector("#statProducts").textContent = Number(summary.products.productCount || 0).toLocaleString("vi-VN");
    document.querySelector("#statStockUnits").textContent = `${Number(summary.products.stockUnits || 0).toLocaleString("vi-VN")} sản phẩm trong kho`;
    document.querySelector("#statPending").textContent = Number(summary.orders.pendingCount || 0).toLocaleString("vi-VN");
    document.querySelector("#statOrders").textContent = `${Number(summary.orders.orderCount || 0).toLocaleString("vi-VN")} đơn hàng`;
    document.querySelector("#statRevenue").textContent = money(summary.orders.completedRevenue);
    document.querySelector("#statCustomers").textContent = Number(summary.users.activeCustomerCount || 0).toLocaleString("vi-VN");
    document.querySelector("#statStockWarnings").textContent =
      `${Number(summary.products.outOfStockCount || 0)} hết hàng · ${Number(summary.products.lowStockCount || 0)} sắp hết`;
  }

  function renderCategories() {
    productCategory.innerHTML = categories.length
      ? categories.map(category => `<option value="${text(category.slug)}">${text(category.name)}</option>`).join("")
      : `<option value="">Chưa có danh mục</option>`;
  }

  function renderProducts() {
    productsBody.innerHTML = products.length ? products.map(product => `
      <tr>
        <td class="admin-product-name">${text(product.name)}<span class="admin-muted">${text(product.slug)}</span></td>
        <td>${text(product.categoryName || product.category)}</td>
        <td class="admin-price">${money(product.price)}${product.oldPrice ? `<span class="admin-muted">${money(product.oldPrice)}</span>` : ""}</td>
        <td>${Number(product.stock).toLocaleString("vi-VN")}</td>
        <td><span class="admin-status ${product.active ? "" : "inactive"}">${product.active ? "Đang bán" : "Đã ẩn"}</span></td>
        <td class="admin-actions">
          <button class="admin-row-button" type="button" data-edit-product="${product.id}">Sửa</button>
          ${product.active ? `<button class="admin-row-button danger" type="button" data-deactivate-product="${product.id}">Ẩn</button>` : ""}
        </td>
      </tr>
    `).join("") : emptyRow(6, "Chưa có sản phẩm nào.");
  }

  function renderInventory() {
    const activeProducts = products.filter(product => product.active);
    inventoryBody.innerHTML = activeProducts.length ? activeProducts
      .slice()
      .sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name, "vi"))
      .map(product => {
        const stock = Number(product.stock);
        const stockState = stock === 0 ? "empty" : stock <= 5 ? "warning" : "";
        const label = stock === 0 ? "Hết hàng" : stock <= 5 ? "Sắp hết" : "Còn hàng";
        const width = Math.min(100, Math.max(stock * 8, stock > 0 ? 8 : 0));
        return `
          <tr>
            <td class="admin-product-name">${text(product.name)}<span class="admin-muted">${text(product.slug)}</span></td>
            <td>${text(product.categoryName || product.category)}</td>
            <td>${Number(product.sold || 0).toLocaleString("vi-VN")}</td>
            <td>${stock.toLocaleString("vi-VN")}</td>
            <td><span class="admin-status ${stockState}">${label}</span><div class="admin-stock-track ${stockState}"><span style="width:${width}%"></span></div></td>
          </tr>
        `;
      }).join("") : emptyRow(5, "Chưa có sản phẩm đang bán.");
  }

  function renderOrders() {
    ordersBody.innerHTML = orders.length ? orders.map(order => {
      const itemNames = order.items.map(item => `${item.name} × ${item.quantity}`).join(", ");
      const itemHtml = order.items.length
        ? `<details class="admin-order-detail"><summary>${order.items.length} dòng hàng</summary><ul>${order.items.map(item => `<li>${text(item.name)} × ${Number(item.quantity)} — ${money(item.total)}</li>`).join("")}</ul>${order.note ? `<p>Ghi chú: ${text(order.note)}</p>` : ""}</details>`
        : `<span class="admin-muted">Không có dòng hàng</span>`;
      return `
        <tr data-order-row="${order.id}">
          <td class="admin-cell-stack"><strong>${text(order.number)}</strong><span class="admin-muted">${new Date(order.createdAt).toLocaleString("vi-VN")}</span></td>
          <td class="admin-cell-stack">${text(order.customerName)}<span class="admin-muted">${text(order.customerPhone || order.customerEmail || "")}</span><span class="admin-muted">${text(order.shippingAddress)}</span></td>
          <td>${itemHtml}<span class="admin-muted">${text(itemNames)}</span></td>
          <td class="admin-price">${money(order.total)}<span class="admin-muted">${text(order.paymentMethod || "")}</span></td>
          <td><select class="admin-select" data-order-status aria-label="Trạng thái đơn ${text(order.number)}">${orderStatuses.map(value => `<option value="${value}" ${order.status === value ? "selected" : ""}>${statusLabel(value)}</option>`).join("")}</select></td>
          <td><select class="admin-select" data-payment-status aria-label="Thanh toán đơn ${text(order.number)}">${paymentStatuses.map(value => `<option value="${value}" ${order.paymentStatus === value ? "selected" : ""}>${statusLabel(value)}</option>`).join("")}</select></td>
          <td class="admin-actions"><button class="admin-row-button" type="button" data-save-order="${order.id}">Lưu</button></td>
        </tr>
      `;
    }).join("") : emptyRow(7, "Chưa có đơn hàng.");
  }

  function renderUsers() {
    usersBody.innerHTML = users.length ? users.map(user => `
      <tr>
        <td class="admin-cell-stack"><strong>${text(user.name)}</strong><span class="admin-muted">${new Date(user.createdAt).toLocaleDateString("vi-VN")}</span></td>
        <td class="admin-email">${text(user.email)}</td>
        <td>${text(user.phone || "—")}</td>
        <td>${user.role === "admin" ? "Quản trị viên" : "Khách hàng"}</td>
        <td><span class="admin-status ${user.active ? "" : "inactive"}">${user.active ? "Hoạt động" : "Đã khóa"}</span></td>
        <td class="admin-actions">${user.role === "customer" ? `<button class="admin-row-button ${user.active ? "danger" : ""}" type="button" data-toggle-user="${user.id}" data-next-active="${!user.active}">${user.active ? "Khóa" : "Mở khóa"}</button>` : `<span class="admin-muted">Quản trị</span>`}</td>
      </tr>
    `).join("") : emptyRow(6, "Chưa có người dùng.");
  }

  async function loadSummary() {
    const summary = await api.get("/api/admin/summary");
    renderStats(summary);
  }

  async function loadProducts() {
    products = await api.get("/api/admin/products");
    renderProducts();
    renderInventory();
  }

  async function loadOrders() {
    orders = await api.get("/api/admin/orders");
    renderOrders();
  }

  async function loadUsers() {
    users = await api.get("/api/admin/users");
    renderUsers();
  }

  function setProductForm(product = null) {
    productForm.reset();
    delete productForm.elements.slug.dataset.edited;
    productForm.hidden = false;
    productForm.elements.productId.value = product ? product.id : "";
    productForm.elements.name.value = product ? product.name : "";
    productForm.elements.slug.value = product ? product.slug : "";
    productForm.elements.category.value = product ? product.category : (categories[0]?.slug || "");
    productForm.elements.tag.value = product ? product.tag || "" : "";
    productForm.elements.price.value = product ? product.price : "";
    productForm.elements.oldPrice.value = product && product.oldPrice != null ? product.oldPrice : "";
    productForm.elements.stock.value = product ? product.stock : "0";
    productForm.elements.image.value = product ? product.image : "";
    productForm.elements.description.value = product ? product.description : "";
    productForm.elements.spec.value = product ? product.spec : "";
    productForm.elements.detail.value = product ? product.detail : "";
    productForm.elements.hot.checked = product ? product.hot : false;
    productForm.elements.active.checked = product ? product.active : true;
    productFormTitle.textContent = product ? "Cập nhật sản phẩm" : "Thêm sản phẩm";
    document.querySelector("#saveProductButton").textContent = product ? "Lưu thay đổi" : "Lưu sản phẩm";
    productForm.scrollIntoView({ behavior: "smooth", block: "start" });
    productForm.elements.name.focus({ preventScroll: true });
  }

  function productFormData() {
    return {
      name: productForm.elements.name.value.trim(),
      slug: productForm.elements.slug.value.trim(),
      category: productForm.elements.category.value,
      tag: productForm.elements.tag.value.trim(),
      price: Number(productForm.elements.price.value),
      oldPrice: productForm.elements.oldPrice.value,
      stock: Number(productForm.elements.stock.value),
      image: productForm.elements.image.value.trim(),
      description: productForm.elements.description.value.trim(),
      spec: productForm.elements.spec.value.trim(),
      detail: productForm.elements.detail.value.trim(),
      hot: productForm.elements.hot.checked,
      active: productForm.elements.active.checked,
    };
  }

  const orderStatuses = ["pending", "confirmed", "shipping", "completed", "cancelled"];
  const paymentStatuses = ["unpaid", "pending", "paid", "refunded", "failed"];

  document.querySelectorAll("[data-admin-tab]").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-admin-tab]").forEach(tab => tab.classList.toggle("active", tab === button));
      document.querySelectorAll("[data-admin-panel]").forEach(panel => {
        const active = panel.dataset.adminPanel === button.dataset.adminTab;
        panel.hidden = !active;
        panel.classList.toggle("active", active);
      });
      clearMessage();
    });
  });

  document.querySelector("#newProductButton").addEventListener("click", () => setProductForm());
  document.querySelector("#cancelProductButton").addEventListener("click", () => {
    productForm.hidden = true;
    productForm.reset();
    clearMessage();
  });

  productForm.elements.name.addEventListener("input", () => {
    if (!productForm.elements.productId.value || !productForm.elements.slug.dataset.edited) {
      productForm.elements.slug.value = productForm.elements.name.value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/đ/g, "d")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    }
  });
  productForm.elements.slug.addEventListener("input", () => {
    productForm.elements.slug.dataset.edited = "true";
    if (!productForm.elements.slug.value) delete productForm.elements.slug.dataset.edited;
  });

  productForm.addEventListener("submit", async event => {
    event.preventDefault();
    clearMessage();
    const submit = document.querySelector("#saveProductButton");
    submit.disabled = true;
    try {
      const productId = productForm.elements.productId.value;
      if (productId) await api.put(`/api/admin/products/${productId}`, productFormData());
      else await api.post("/api/admin/products", productFormData());
      productForm.hidden = true;
      productForm.reset();
      try {
        await Promise.all([loadProducts(), loadSummary()]);
        showMessage("Đã lưu thông tin sản phẩm.", "success");
      } catch (error) {
        showMessage(`Đã lưu sản phẩm nhưng chưa tải lại được danh sách: ${error.message}`);
      }
    } catch (error) {
      showMessage(error.message);
    } finally {
      submit.disabled = false;
    }
  });

  productsBody.addEventListener("click", async event => {
    const editButton = event.target.closest("[data-edit-product]");
    if (editButton) {
      const product = products.find(item => item.id === Number(editButton.dataset.editProduct));
      if (product) setProductForm(product);
      return;
    }
    const deactivateButton = event.target.closest("[data-deactivate-product]");
    if (!deactivateButton) return;
    deactivateButton.disabled = true;
    clearMessage();
    try {
      await api.delete(`/api/admin/products/${deactivateButton.dataset.deactivateProduct}`);
      await Promise.all([loadProducts(), loadSummary()]);
      showMessage("Đã ẩn sản phẩm khỏi cửa hàng.", "success");
    } catch (error) {
      showMessage(error.message);
      deactivateButton.disabled = false;
    }
  });

  ordersBody.addEventListener("click", async event => {
    const button = event.target.closest("[data-save-order]");
    if (!button) return;
    const row = button.closest("[data-order-row]");
    const orderId = button.dataset.saveOrder;
    button.disabled = true;
    clearMessage();
    try {
      await api.put(`/api/admin/orders/${orderId}`, {
        status: row.querySelector("[data-order-status]").value,
        paymentStatus: row.querySelector("[data-payment-status]").value,
      });
      try {
        await Promise.all([loadOrders(), loadSummary(), loadProducts()]);
        showMessage("Đã cập nhật trạng thái đơn hàng.", "success");
      } catch (error) {
        showMessage(`Đã cập nhật đơn hàng nhưng chưa tải lại được dữ liệu: ${error.message}`);
      }
    } catch (error) {
      showMessage(error.message);
      button.disabled = false;
    }
  });

  usersBody.addEventListener("click", async event => {
    const button = event.target.closest("[data-toggle-user]");
    if (!button) return;
    button.disabled = true;
    clearMessage();
    try {
      await api.put(`/api/admin/users/${button.dataset.toggleUser}/active`, {
        active: button.dataset.nextActive === "true",
      });
      try {
        await Promise.all([loadUsers(), loadSummary()]);
        showMessage("Đã cập nhật trạng thái tài khoản.", "success");
      } catch (error) {
        showMessage(`Đã cập nhật tài khoản nhưng chưa tải lại được danh sách: ${error.message}`);
      }
    } catch (error) {
      showMessage(error.message);
      button.disabled = false;
    }
  });

  document.querySelectorAll("[data-refresh]").forEach(button => {
    button.addEventListener("click", async () => {
      clearMessage();
      button.disabled = true;
      try {
        if (button.dataset.refresh === "orders") await loadOrders();
        else if (button.dataset.refresh === "users") await loadUsers();
        else await Promise.all([loadProducts(), loadSummary()]);
      } catch (error) {
        showMessage(error.message);
      } finally {
        button.disabled = false;
      }
    });
  });

  async function initialize() {
    try {
      const { user } = await api.get("/api/auth/me");
      if (!user || user.role !== "admin") {
        window.location.replace(user ? "index.html" : "tai-khoan.html?next=admin.html");
        return;
      }
      const results = await Promise.all([
        api.get("/api/categories"),
        api.get("/api/admin/summary"),
        api.get("/api/admin/products"),
        api.get("/api/admin/orders"),
        api.get("/api/admin/users"),
      ]);
      categories = results[0];
      renderCategories();
      renderStats(results[1]);
      products = results[2];
      orders = results[3];
      users = results[4];
      renderProducts();
      renderInventory();
      renderOrders();
      renderUsers();
    } catch (error) {
      if (error.status === 401) window.location.replace("tai-khoan.html?next=admin.html");
      else if (error.status === 403) window.location.replace("index.html");
      else showMessage(error.message);
    }
  }

  initialize();
})();
