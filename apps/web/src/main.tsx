import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { JobsPage, Layout } from "./App.tsx";
import { CardPage } from "./CardPage.tsx";
import { CollectionPage, ContainerPage } from "./Collection.tsx";
import { CollectorPage } from "./Collector.tsx";
import { ImportPage } from "./ImportPage.tsx";
import { I18nProvider } from "./i18n.tsx";
import { AlertsPage, SettingsPage } from "./Prices.tsx";
import { RestorePage } from "./Restore.tsx";
import { SearchPage, validateSearch } from "./Search.tsx";
import "./index.css";

const root = createRootRoute({ component: Layout });
const routeTree = root.addChildren([
  createRoute({ getParentRoute: () => root, path: "/", component: SearchPage, validateSearch }),
  createRoute({ getParentRoute: () => root, path: "/card/$id", component: CardPage }),
  createRoute({ getParentRoute: () => root, path: "/collection", component: CollectionPage }),
  createRoute({ getParentRoute: () => root, path: "/container/$id", component: ContainerPage }),
  createRoute({ getParentRoute: () => root, path: "/collector", component: CollectorPage }),
  createRoute({ getParentRoute: () => root, path: "/import", component: ImportPage }),
  createRoute({ getParentRoute: () => root, path: "/restore", component: RestorePage }),
  createRoute({ getParentRoute: () => root, path: "/alerts", component: AlertsPage }),
  createRoute({ getParentRoute: () => root, path: "/settings", component: SettingsPage }),
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
