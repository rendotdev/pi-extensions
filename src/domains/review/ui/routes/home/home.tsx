import { defineUIComponent } from "../../../../../define.ts";
import { homeRouteDeps } from "./home-route-deps.ts";
import { HomeRouteView } from "./home-route-view.tsx";

export const HomeRoute = defineUIComponent({
  params: {},
  deps: homeRouteDeps,
  component(_props: {}) {
    return <HomeRouteView />;
  },
});
