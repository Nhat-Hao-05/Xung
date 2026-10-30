(() => {
  async function request(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const response = await fetch(url, {
      ...options,
      headers,
      credentials: "same-origin",
    });
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(body?.error || `Yêu cầu thất bại (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);
  }

  window.XungAPI = {
    request,
    get: url => request(url),
    post: (url, body = {}) => request(url, { method: "POST", body: JSON.stringify(body) }),
    put: (url, body = {}) => request(url, { method: "PUT", body: JSON.stringify(body) }),
    delete: url => request(url, { method: "DELETE" }),
    escapeHtml,
    formatPrice: value => new Intl.NumberFormat("vi-VN").format(Number(value) || 0) + "đ",
  };
})();
