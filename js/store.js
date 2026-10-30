const safeText = XungAPI.escapeHtml;
const formatPrice = XungAPI.formatPrice;
let signedInUser = null;

function displayCartCount(count) {
  const badge = document.getElementById("cartCount");
  if (badge) badge.textContent = String(count || 0);
}

async function refreshCartCount() {
  try {
    const profile = await XungAPI.get("/api/auth/me");
    if (!profile.user) {
      displayCartCount(0);
      return;
    }
    const cart = await XungAPI.get("/api/cart");
    displayCartCount(cart.itemCount);
  } catch (error) {
    displayCartCount(0);
    if (error.status !== 401) console.error("Không tải được số lượng giỏ:", error.message);
  }
}

async function addToCart(productSlug) {
  try {
    const cart = await XungAPI.post("/api/cart/items", { productSlug, quantity: 1 });
    displayCartCount(cart.itemCount);
    const button = document.querySelector(`[data-product-id="${CSS.escape(productSlug)}"] .add-btn, [data-add-product="${CSS.escape(productSlug)}"]`);
    if (button) {
      const previousLabel = button.getAttribute("aria-label") || "Thêm vào giỏ";
      button.setAttribute("aria-label", "Đã thêm vào giỏ");
      button.classList.add("added");
      window.setTimeout(() => {
        button.setAttribute("aria-label", previousLabel);
        button.classList.remove("added");
      }, 1000);
    }
    return cart;
  } catch (error) {
    if (error.status === 401) {
      try {
        sessionStorage.setItem("xung-pending-cart", productSlug);
        sessionStorage.setItem("xung-return-to", location.pathname + location.search);
      } catch { /* Continue to login if storage is unavailable. */ }
      location.href = "tai-khoan.html";
      return null;
    }
    alert(error.message);
    return null;
  }
}
window.XungStore = { addToCart, refreshCartCount };

function renderProductCard(product) {
  const slug = encodeURIComponent(product.id);
  const oldPrice = product.oldPrice && product.oldPrice > product.price
    ? `<span class="price-old">${formatPrice(product.oldPrice)}</span>`
    : "";
  return `<article class="card" data-product-id="${safeText(product.id)}">
    <div class="card-media"><div class="card-top"><span class="tag ${product.hot ? "hot" : ""}">${safeText(product.tag)}</span><button class="heart" aria-label="Yêu thích" data-wishlist="${safeText(product.id)}"><img src="images/icons/heart.svg" alt=""></button></div>
      <a href="chi-tiet.html?id=${slug}"><img class="card-img" src="${safeText(product.image)}" alt="${safeText(product.name)}"></a>
    </div>
    <div class="card-body"><span class="card-cat">${safeText(product.cat)}</span><h3 class="card-name"><a href="chi-tiet.html?id=${slug}">${safeText(product.name)}</a></h3><p class="card-spec">${safeText(product.spec)}</p>
      <div class="rating"><b>★</b><span>${safeText(product.rating)}</span></div><div class="price-row"><div>${oldPrice}<span class="price">${formatPrice(product.price)}</span></div><button class="add-btn" aria-label="Thêm vào giỏ"><img src="images/icons/plus.svg" alt=""></button></div>
    </div></article>`;
}

const catalogGrid = document.getElementById("catalogGrid");
if (catalogGrid) {
  let selectedCategory = new URLSearchParams(location.search).get("category") || "all";
  const searchField = document.getElementById("catalogSearch");
  const sortField = document.getElementById("catalogSort");
  const resultCount = document.getElementById("resultCount");
  const emptyState = document.getElementById("catalogEmpty");
  const categoryButtons = [...document.querySelectorAll(".category-filter")];
  searchField.value = new URLSearchParams(location.search).get("q") || "";
  if (!["all", "laptop", "phone", "accessory"].includes(selectedCategory)) selectedCategory = "all";
  if (new URLSearchParams(location.search).get("sort") === "sale") sortField.value = "sale";

  let searchTimer;
  async function renderCatalog() {
    catalogGrid.setAttribute("aria-busy", "true");
    const params = new URLSearchParams();
    if (selectedCategory !== "all") params.set("category", selectedCategory);
    if (searchField.value.trim()) params.set("q", searchField.value.trim());
    if (sortField.value !== "featured") params.set("sort", sortField.value);
    try {
      const products = await XungAPI.get(`/api/products?${params}`);
      catalogGrid.innerHTML = products.map(renderProductCard).join("");
      resultCount.textContent = String(products.length);
      emptyState.hidden = products.length > 0;
      if (!products.length) emptyState.innerHTML = "<strong>Chưa tìm thấy sản phẩm phù hợp</strong><span>Thử từ khóa khác hoặc chọn một danh mục khác nhé.</span>";
    } catch (error) {
      catalogGrid.innerHTML = "";
      emptyState.hidden = false;
      emptyState.innerHTML = `<strong>Không tải được sản phẩm</strong><span>${safeText(error.message)} Hãy mở website từ server local.</span>`;
    } finally {
      catalogGrid.removeAttribute("aria-busy");
    }
  }

  categoryButtons.forEach(button => {
    button.classList.toggle("active", button.dataset.category === selectedCategory);
    button.addEventListener("click", () => {
      selectedCategory = button.dataset.category;
      categoryButtons.forEach(item => item.classList.toggle("active", item === button));
      renderCatalog();
    });
  });
  searchField.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(renderCatalog, 220);
  });
  sortField.addEventListener("change", renderCatalog);
  renderCatalog();
}

const detailRoot = document.getElementById("productDetail");
if (detailRoot) {
  const slug = new URLSearchParams(location.search).get("id");
  async function renderProductDetail() {
    try {
      const product = await XungAPI.get(`/api/products/${encodeURIComponent(slug || "")}`);
      document.title = `${product.name} | XUNG`;
      document.getElementById("productBreadcrumb").textContent = product.name;
      const oldPrice = product.oldPrice && product.oldPrice > product.price
        ? `<span class="price-old">${formatPrice(product.oldPrice)}</span>`
        : "";
      detailRoot.innerHTML = `<div class="detail-image"><span class="tag ${product.hot ? "hot" : ""}">${safeText(product.tag)}</span><img src="${safeText(product.image)}" alt="${safeText(product.name)}"></div>
        <div class="detail-copy"><span class="card-cat">${safeText(product.cat)}</span><h1>${safeText(product.name)}</h1><div class="rating"><b>★</b><span>${safeText(product.rating)}</span></div><p class="detail-description-copy">${safeText(product.description)}</p>
          <div class="detail-price">${oldPrice}<strong>${formatPrice(product.price)}</strong></div><p class="detail-spec">${safeText(product.detail)}</p>
          <p class="stock-note">Còn ${product.stockQuantity} sản phẩm</p>
          <div class="detail-actions"><button class="btn btn-primary" data-add-product="${safeText(product.id)}" type="button">Thêm vào giỏ <img src="images/icons/shopping-bag.svg" alt=""></button><a class="btn btn-secondary" href="gio-hang.html">Xem giỏ hàng</a></div>
          <div class="detail-delivery"><img src="images/icons/truck.svg" alt=""><span>Giao hàng nhanh, miễn phí vận chuyển cho đơn hàng này.</span></div>
        </div>`;
    } catch (error) {
      detailRoot.innerHTML = `<div class="empty-state"><strong>Không tải được sản phẩm</strong><span>${safeText(error.message)}</span><a class="btn btn-primary" href="san-pham.html">Quay lại cửa hàng</a></div>`;
    }
  }
  renderProductDetail();
}

const cartItemsRoot = document.getElementById("cartItems");
if (cartItemsRoot) {
  const empty = document.getElementById("cartEmpty");
  const summary = document.querySelector(".order-summary");
  const tableHead = document.querySelector(".cart-table-head");
  const checkoutButton = document.getElementById("checkoutButton");
  const checkoutDialog = document.getElementById("checkoutDialog");
  const checkoutForm = document.getElementById("checkoutForm");
  const receiptDialog = document.getElementById("receiptDialog");

  function renderReceipt(receipt) {
    const paymentMethods = {
      cod: "Thanh toán khi nhận hàng",
      bank_transfer: "Chuyển khoản",
      online: "Thanh toán trực tuyến",
    };
    const date = new Date(receipt.createdAt);
    document.getElementById("receiptNumber").textContent = receipt.number;
    document.getElementById("receiptDate").textContent =
      Number.isNaN(date.getTime()) ? "" : date.toLocaleString("vi-VN");
    document.getElementById("receiptCustomer").textContent = receipt.customer.name;
    document.getElementById("receiptPhone").textContent = `${receipt.customer.phone} · ${receipt.customer.email}`;
    document.getElementById("receiptAddress").textContent = [
      receipt.shippingAddress.address,
      receipt.shippingAddress.ward,
      receipt.shippingAddress.district,
      receipt.shippingAddress.city,
    ].filter(Boolean).join(", ");
    document.getElementById("receiptPayment").textContent =
      `Phương thức thanh toán: ${paymentMethods[receipt.paymentMethod] || receipt.paymentMethod}`;
    document.getElementById("receiptItems").innerHTML = receipt.items.map(item => `
      <tr>
        <td>${safeText(item.name)}</td>
        <td>${formatPrice(item.unitPrice)}</td>
        <td>${Number(item.quantity)}</td>
        <td>${formatPrice(item.total)}</td>
      </tr>
    `).join("");
    document.getElementById("receiptSubtotal").textContent = formatPrice(receipt.subtotal);
    document.getElementById("receiptShipping").textContent =
      receipt.shippingFee ? formatPrice(receipt.shippingFee) : "Miễn phí";
    document.getElementById("receiptDiscount").textContent = formatPrice(receipt.discount);
    document.getElementById("receiptTotal").textContent = formatPrice(receipt.total);
    const note = document.getElementById("receiptNote");
    note.textContent = receipt.note ? `Ghi chú: ${receipt.note}` : "";
    note.hidden = !receipt.note;
    receiptDialog.showModal();
  }

  function renderCart(cart) {
    const items = cart.items || [];
    cartItemsRoot.innerHTML = items.map(item => `<article class="cart-row" data-cart-line="${safeText(item.id)}">
      <div class="cart-product"><a href="chi-tiet.html?id=${encodeURIComponent(item.id)}"><img src="${safeText(item.image)}" alt="${safeText(item.name)}"></a><div><a class="cart-product-name" href="chi-tiet.html?id=${encodeURIComponent(item.id)}">${safeText(item.name)}</a><span>${safeText(item.spec)}</span><button class="remove-item" data-remove="${safeText(item.id)}" type="button">Xóa</button></div></div>
      <strong class="cart-unit-price">${formatPrice(item.price)}</strong><div class="quantity-control"><button type="button" data-quantity="-1" data-id="${safeText(item.id)}" aria-label="Giảm số lượng">−</button><span>${item.quantity}</span><button type="button" data-quantity="1" data-id="${safeText(item.id)}" aria-label="Tăng số lượng">+</button></div><strong class="cart-line-total">${formatPrice(item.lineTotal)}</strong>
    </article>`).join("");
    const hasItems = items.length > 0;
    empty.hidden = hasItems;
    summary.hidden = !hasItems;
    tableHead.hidden = !hasItems;
    document.getElementById("subtotal").textContent = formatPrice(cart.subtotal);
    document.getElementById("grandTotal").textContent = formatPrice(cart.subtotal);
    displayCartCount(cart.itemCount);
  }

  async function loadCart() {
    try {
      const profile = await XungAPI.get("/api/auth/me");
      if (!profile.user) {
        displayCartCount(0);
        summary.hidden = true;
        tableHead.hidden = true;
        cartItemsRoot.innerHTML = "";
        empty.hidden = false;
        empty.innerHTML = '<strong>Đăng nhập để dùng giỏ hàng</strong><span>Giỏ hàng sẽ được lưu cùng tài khoản của bạn.</span><a class="btn btn-primary" href="tai-khoan.html">Đăng nhập hoặc đăng ký</a>';
        return;
      }
      renderCart(await XungAPI.get("/api/cart"));
    } catch (error) {
      displayCartCount(0);
      summary.hidden = true;
      tableHead.hidden = true;
      cartItemsRoot.innerHTML = "";
      empty.hidden = false;
      empty.innerHTML = error.status === 401
        ? '<strong>Đăng nhập để dùng giỏ hàng</strong><span>Giỏ hàng sẽ được lưu cùng tài khoản của bạn.</span><a class="btn btn-primary" href="tai-khoan.html">Đăng nhập hoặc đăng ký</a>'
        : `<strong>Không tải được giỏ hàng</strong><span>${safeText(error.message)}</span>`;
    }
  }

  cartItemsRoot.addEventListener("click", async event => {
    const removeButton = event.target.closest("[data-remove]");
    const quantityButton = event.target.closest("[data-quantity]");
    try {
      if (removeButton) await XungAPI.delete(`/api/cart/items/${encodeURIComponent(removeButton.dataset.remove)}`);
      if (quantityButton) {
        const cart = await XungAPI.get("/api/cart");
        const item = cart.items.find(row => row.id === quantityButton.dataset.id);
        if (item) await XungAPI.put(`/api/cart/items/${encodeURIComponent(item.id)}`, { quantity: item.quantity + Number(quantityButton.dataset.quantity) });
      }
      if (removeButton || quantityButton) await loadCart();
    } catch (error) { alert(error.message); }
  });

  if (checkoutButton && checkoutDialog && checkoutForm) {
    checkoutButton.addEventListener("click", async () => {
      try {
        const profile = await XungAPI.get("/api/auth/me");
        if (!profile.user) {
          location.href = "tai-khoan.html";
          return;
        }
        const cart = await XungAPI.get("/api/cart");
        if (!cart.items.length) return;
        checkoutForm.elements.name.value = profile.user?.name || "";
        checkoutForm.elements.email.value = profile.user?.email || "";
        document.getElementById("checkoutMessage").textContent = "";
        checkoutDialog.showModal();
      } catch (error) {
        if (error.status === 401) location.href = "tai-khoan.html";
        else alert(error.message);
      }
    });
    checkoutDialog.querySelector("[data-close-checkout]").addEventListener("click", () => checkoutDialog.close());
    checkoutDialog.addEventListener("click", event => {
      if (event.target === checkoutDialog) checkoutDialog.close();
    });
    checkoutForm.addEventListener("submit", async event => {
      event.preventDefault();
      if (!checkoutForm.reportValidity()) return;
      const submit = checkoutForm.querySelector("[type=submit]");
      const message = document.getElementById("checkoutMessage");
      submit.disabled = true;
      message.textContent = "Đang tạo đơn hàng…";
      try {
        const data = Object.fromEntries(new FormData(checkoutForm));
        const result = await XungAPI.post("/api/orders", data);
        checkoutDialog.close();
        checkoutForm.reset();
        if (result.receipt) {
          renderReceipt(result.receipt);
        } else {
          alert(`Đơn hàng ${result.order.number} đã được tạo. Hãy tải lại server để xem hóa đơn.`);
        }
        await loadCart();
      } catch (error) {
        message.textContent = error.message;
        message.classList.add("error");
      } finally {
        submit.disabled = false;
      }
    });
  }

  if (receiptDialog) {
    document.getElementById("printReceiptButton").addEventListener("click", () => window.print());
    document.getElementById("closeReceiptButton").addEventListener("click", () => receiptDialog.close());
    receiptDialog.addEventListener("click", event => {
      if (event.target === receiptDialog) receiptDialog.close();
    });
  }

  loadCart();
}

async function toggleWishlist(button) {
  const slug = button.dataset.wishlist;
  try {
    if (button.classList.contains("liked")) {
      await XungAPI.delete(`/api/wishlist/${encodeURIComponent(slug)}`);
      button.classList.remove("liked");
    } else {
      await XungAPI.post(`/api/wishlist/${encodeURIComponent(slug)}`);
      button.classList.add("liked");
    }
  } catch (error) {
    if (error.status === 401) location.href = "tai-khoan.html";
    else alert(error.message);
  }
}

document.addEventListener("click", event => {
  const addButton = event.target.closest(".add-btn, [data-add-product]");
  if (addButton) {
    const card = addButton.closest("[data-product-id]");
    const slug = addButton.dataset.addProduct || card?.dataset.productId;
    if (slug) addToCart(slug);
  }
  const heart = event.target.closest("[data-wishlist]");
  if (heart) toggleWishlist(heart);
});

document.querySelectorAll("[data-site-search]").forEach(input => {
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && input.value.trim()) location.href = `san-pham.html?q=${encodeURIComponent(input.value.trim())}`;
  });
});

refreshCartCount();
