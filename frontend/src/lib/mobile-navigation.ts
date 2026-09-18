export type MobileNavigationItem = {
  href: string;
  label: string;
};

function matchesPath(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href.split("?")[0]);
}

export function buildMobileNavigation<T extends MobileNavigationItem>(items: T[], pathname: string) {
  const preferred = ["/", "/projects", "/timesheet", "/work-schedule"];
  const primary = preferred
    .map((href) => items.find((item) => item.href === href))
    .filter((item): item is T => Boolean(item));
  const primaryHrefs = new Set(primary.map((item) => item.href));
  const secondary = items.filter((item) => !primaryHrefs.has(item.href));

  return {
    primary,
    secondary,
    moreActive: secondary.some((item) => matchesPath(item.href, pathname)),
  };
}
