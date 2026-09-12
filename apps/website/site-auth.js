import { getStoredSession } from "./auth-client.js";

function renderAccountLinks() {
  const session = getStoredSession();
  document.querySelectorAll("[data-account-link]").forEach((link) => {
    link.textContent = "账号";
    link.classList.toggle("signed-in", Boolean(session));
    link.setAttribute("aria-label", session ? "进入 OIO 账号中心" : "进入 OIO 账号并登录");
  });
}

renderAccountLinks();
window.addEventListener("storage", renderAccountLinks);
window.addEventListener("oio:session-changed", renderAccountLinks);
