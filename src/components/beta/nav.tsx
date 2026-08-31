// Beta navigation — plain hash links so pages are linkable and the browser
// back/forward buttons work. `Link` renders an <a href="#/route">; the app's
// URL-sync effect turns the hash into the view. For the details page, a
// `section` prop appends ?section=… so the page scrolls to the tapped section.
import type { ReactNode, MouseEvent } from 'react';
import { hashForView, type View } from '../../lib/viewRoutes';

export function Link({ view, section, className, children, ...rest }: {
  view: View;
  section?: string;
  className?: string;
  children: ReactNode;
  'aria-label'?: string;
}) {
  const href = hashForView(view) + (section ? `?section=${section}` : '');
  // Let the default anchor navigation set the hash; App's hash listener picks
  // it up. No preventDefault — keep it a real link (open-in-new-tab works).
  const onClick = (_e: MouseEvent<HTMLAnchorElement>) => { /* real link */ };
  return (
    <a href={href} className={className} onClick={onClick} {...rest}>
      {children}
    </a>
  );
}
