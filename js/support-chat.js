(() => {
  if (window.Tawk_API) return;

  window.Tawk_API = window.Tawk_API || {};
  window.Tawk_LoadStart = new Date();

  const firstScript = document.getElementsByTagName("script")[0];
  if (!firstScript || !firstScript.parentNode) {
    console.error("Không thể khởi tạo khung chat hỗ trợ tawk.to.");
    return;
  }

  const chatScript = document.createElement("script");
  chatScript.async = true;
  chatScript.src = "https://embed.tawk.to/6af67f88a0f2d73c48f3e637/1k79e4bl6";
  chatScript.charset = "UTF-8";
  chatScript.setAttribute("crossorigin", "*");
  firstScript.parentNode.insertBefore(chatScript, firstScript);
})();
