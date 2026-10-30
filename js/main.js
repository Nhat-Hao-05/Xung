const featuredGrid = document.getElementById("featuredGrid");
const accessoryGrid = document.getElementById("accessoryGrid");
const promoCard = document.getElementById("promoCard");
const chips = document.getElementById("chips");

function productCard(product, compact = false) {
  const safe = XungAPI.escapeHtml;
  const id = encodeURIComponent(product.id);
  const oldPrice = product.oldPrice && product.oldPrice > product.price
    ? `<span class="price-old">${XungAPI.formatPrice(product.oldPrice)}</span>`
    : "";
  return `<article class="card ${compact ? "compact" : ""}" data-product-id="${safe(product.id)}">
    <div class="card-media"><div class="card-top"><span class="tag ${product.hot ? "hot" : ""}">${safe(product.tag)}</span><button class="heart" aria-label="Yêu thích" data-wishlist="${safe(product.id)}"><img src="images/icons/heart.svg" alt=""></button></div>
      <a href="chi-tiet.html?id=${id}"><img class="card-img" src="${safe(product.image)}" alt="${safe(product.name)}"></a>
    </div>
    <div class="card-body"><span class="card-cat">${safe(product.cat)}</span><h3 class="card-name"><a href="chi-tiet.html?id=${id}">${safe(product.name)}</a></h3><p class="card-spec">${safe(product.spec)}</p>
      <div class="rating"><b>★</b><span>${safe(product.rating)}</span></div><div class="price-row"><div>${oldPrice}<span class="price">${XungAPI.formatPrice(product.price)}</span></div><button class="add-btn" aria-label="Thêm vào giỏ"><img src="images/icons/plus.svg" alt=""></button></div>
    </div></article>`;
}

if (featuredGrid && accessoryGrid && promoCard && chips) {
  let allProducts = [];
  function renderFeatured(filter = "all") {
    const matching = allProducts.filter(product => filter === "all" || product.group === filter);
    featuredGrid.innerHTML = matching.slice(0, 4).map(product => productCard(product)).join("");
  }

  chips.addEventListener("click", event => {
    const chip = event.target.closest(".chip");
    if (!chip) return;
    chips.querySelectorAll(".chip").forEach(item => item.classList.toggle("active", item === chip));
    renderFeatured(chip.dataset.filter);
  });

  XungAPI.get("/api/products")
    .then(products => {
      allProducts = products;
      renderFeatured(chips.querySelector(".chip.active")?.dataset.filter || "all");
      const accessories = products.filter(product => product.category === "accessory");
      promoCard.insertAdjacentHTML("beforebegin", accessories.slice(0, 3).map(product => productCard(product, true)).join(""));
    })
    .catch(error => {
      featuredGrid.innerHTML = `<div class="empty-state"><strong>Chưa tải được sản phẩm</strong><span>${XungAPI.escapeHtml(error.message)} Hãy mở website từ server local.</span></div>`;
      accessoryGrid.insertAdjacentHTML("afterbegin", `<p class="api-error">Không kết nối được API sản phẩm.</p>`);
    });
}

const newsletterForm = document.getElementById("newsletterForm");
if (newsletterForm) {
  newsletterForm.addEventListener("submit", event => {
    event.preventDefault();
    alert("Cảm ơn bạn đã đăng ký!");
    newsletterForm.reset();
  });
}
