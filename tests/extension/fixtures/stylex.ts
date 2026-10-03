import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
  probe: { width: 133, height: 17, backgroundColor: 'rgb(12, 34, 56)' },
});

export const probe = stylex.props(styles.probe);
