import * as stylex from '@stylexjs/stylex';

import { Icon } from '../icons/Icon';
import { Badge } from './index';

const styles = stylex.create({
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'end',
    gap: 4,
    minWidth: 0,
    maxWidth: '100%',
  },
  item: { display: 'flex', minWidth: 0, maxWidth: '100%' },
  badge: { minWidth: 0, maxWidth: '100%', gap: 4 },
  title: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
});

export function MessageAttachments({
  contexts,
}: {
  contexts: readonly { id: string; title: string }[];
}) {
  if (!contexts.length) return null;
  return (
    <ul {...stylex.props(styles.list)} aria-label="附加的网页">
      {contexts.map((context) => (
        <li key={context.id} {...stylex.props(styles.item)}>
          <Badge
            {...stylex.props(styles.badge)}
            title={context.title}
            icon={<Icon name="page" size={12} />}
          >
            <span {...stylex.props(styles.title)}>{context.title}</span>
          </Badge>
        </li>
      ))}
    </ul>
  );
}
