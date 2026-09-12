import { getStoredSession } from "./auth-client.js";

function renderAccountLinks() {
  const session = getStoredSession();
  document.querySelectorAll("[data-account-link]").forEach((link) => {
    link.textContent = session ? "账号" : "登录";
    link.classList.toggle("signed-in", Boolean(session));
    link.setAttribute("aria-label", session ? "进入 OIO 账号中心" : "登录 OIO 账号");
  });
}

renderAccountLinks();
window.addEventListener("storage", renderAccountLinks);
window.addEventListener("oio:session-changed", renderAccountLinks);
