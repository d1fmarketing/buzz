import { useEffect, useState } from "react";

export interface RouteLocation {
  pathname: string;
  search: URLSearchParams;
}

function readLocation(): RouteLocation {
  return {
    pathname: window.location.pathname,
    search: new URLSearchParams(window.location.search),
  };
}

export function useRouteLocation(): RouteLocation {
  const [location, setLocation] = useState<RouteLocation>(readLocation);

  useEffect(() => {
    const onLocationChange = () => setLocation(readLocation());
    window.addEventListener("popstate", onLocationChange);
    window.addEventListener("cockpit:navigate", onLocationChange);
    return () => {
      window.removeEventListener("popstate", onLocationChange);
      window.removeEventListener("cockpit:navigate", onLocationChange);
    };
  }, []);

  return location;
}

export function navigate(to: string, options?: { replace?: boolean }): void {
  const current = `${window.location.pathname}${window.location.search}`;
  if (current === to) return;

  if (options?.replace) {
    window.history.replaceState(null, "", to);
  } else {
    window.history.pushState(null, "", to);
  }
  window.dispatchEvent(new Event("cockpit:navigate"));
}

export function handleInternalLink(
  event: React.MouseEvent<HTMLAnchorElement>,
): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }

  const anchor = event.currentTarget;
  const url = new URL(anchor.href);
  if (url.origin !== window.location.origin) return;

  event.preventDefault();
  navigate(`${url.pathname}${url.search}${url.hash}`);
}

export function updateSearchParam(key: string, value?: string): void {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  navigate(`${url.pathname}${url.search}`, { replace: true });
}
