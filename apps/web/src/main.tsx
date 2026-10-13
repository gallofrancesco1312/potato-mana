import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { JobsPage, Layout } from "./App.tsx";
import { CardPage } from "./CardPage.tsx";
import { I18nProvider } from "./i18n.tsx";
import { SearchPage, validateSearch } from "./Search.tsx";
import "./index.css";

const root = createRootRoute({ component: Layout });
const routeTree = root.addChildren([
  createRoute({ getParentRoute: () => root, path: "/", component: SearchPage, validateSearch }),
  createRoute({ getParentRoute: () => root, path: "/card/$id", component: CardPage }),
  createRoute({ getParentRoute: () => root, path: "/admin/jobs", component: JobsPage }),
]);
const router = createRouter({ routeTree });
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
