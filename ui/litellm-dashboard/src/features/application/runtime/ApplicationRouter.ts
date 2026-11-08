import { createRouter, createWebHistory } from "vue-router";

// The root owns the shared shell; the URL selects a feature without duplicating it.
export const applicationRouter = createRouter({
	// Resource base URLs include /ui; route.fullPath must retain that complete path.
	history: createWebHistory("/"),
	routes: [{ path: "/:pathMatch(.*)*", component: { render: () => null } }],
});
