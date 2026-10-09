import * as stylex from '@stylexjs/stylex';
import { NavLink } from 'react-router';
import * as v from 'valibot';

import { productConfig } from '../../app/product-config';
import { Button, Field, Select, Switch } from '../../shared/ui';
import { composer } from '../../shared/ui/composer.stylex';
import { AccountPage } from '../account/AccountPage';
import { useAccount } from '../account/useAccount';
import { NotificationSettings } from '../notifications/NotificationSettings';
import type { Preferences } from '../preferences/model';
import { BrowserPrivacySettings } from '../privacy/BrowserPrivacySettings';
import { UpdateSettings } from '../updates/UpdateNotice';
import { workspaceScope } from './state';

const styles = stylex.create({
  settings: {
    display: 'grid',
    alignContent: 'start',
    gap: 24,
    paddingBlock: '8px 24px',
    minHeight: 0,
  },
  heading: { fontSize: 20, margin: 0 },
  section: { display: 'grid', gap: 16 },
  title: { fontSize: 13, fontWeight: 600, color: composer.hint, margin: 0 },
  form: { display: 'grid', gap: 8 },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
});
const themes = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

export function Settings({
  preferences,
  onSave,
  pending,
}: {
  preferences: Preferences;
  onSave: (value: Preferences) => void;
  pending: boolean;
}) {
  'use no memo';
  const account = useAccount();
  const scope =
    account.account && account.workspace
      ? JSON.stringify([
          workspaceScope(
            productConfig.authOrigin,
            productConfig.clientId,
            account.account.user.id,
            account.workspace.id,
          ),
          new URL(productConfig.convexOrigin).origin,
        ])
      : undefined;
  return (
    <section {...stylex.props(styles.settings)} aria-label="Settings">
      <div {...stylex.props(styles.row)}>
        <h2 {...stylex.props(styles.heading)}>设置</h2>
        <Button variant="ghost" size="small" nativeButton={false} render={<NavLink to="/" />}>
          返回对话
        </Button>
      </div>
      <AccountPage />
      <BrowserPrivacySettings {...(scope ? { scope } : {})} />
      <NotificationSettings key={scope ?? 'signed-out'} />
      <UpdateSettings />
      <section {...stylex.props(styles.section)} aria-label="外观">
        <h3 {...stylex.props(styles.title)}>外观</h3>
        <Field.Root disabled={pending}>
          <Field.Label>主题</Field.Label>
          <Select.Root
            items={themes}
            value={preferences.theme}
            onValueChange={(theme) => {
              const result = v.safeParse(v.picklist(['system', 'light', 'dark']), theme);
              if (result.success) onSave({ ...preferences, theme: result.output });
            }}
          >
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {themes.map((item) => (
                <Select.Item key={item.value} value={item.value}>
                  {item.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Field.Root>
        <Field.Root disabled={pending}>
          <div {...stylex.props(styles.row)}>
            <Field.Label htmlFor="ambient">背景动态效果</Field.Label>
            <Switch
              id="ambient"
              checked={preferences.ambient}
              onCheckedChange={(ambient) => onSave({ ...preferences, ambient })}
            />
          </div>
          <Field.Description>
            为侧栏背景添加柔和的动态光效；系统开启“减少动态效果”时会自动停用。
          </Field.Description>
        </Field.Root>
      </section>
    </section>
  );
}
