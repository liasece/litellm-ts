/* Keep relative production assets under this installation's UI prefix. */
(function () {
	const match = window.location.pathname.match(/^(.*\/ui)(?:\/.*)?$/);
	const base = document.querySelector("base[data-ui-base]") || document.createElement("base");
	base.href = window.location.origin + (match ? match[1] : "/ui") + "/";
	if (!base.isConnected) document.head.prepend(base);
})();
