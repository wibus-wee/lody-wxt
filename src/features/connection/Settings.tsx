import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';
import { NavLink, useSearchParams } from 'react-router';
import * as v from 'valibot';

import { productConfig } from '../../app/product-config';
import { Button, Field, Select, Switch } from '../../shared/ui';
import { composer } from '../../shared/ui/composer.stylex';
import { AccountPage } from '../account/AccountPage';
import { useAccount } from '../account/useAccount';
import { NotificationSettings } from '../notifications/NotificationSettings';
import type { Preferences } from '../preferences/model';
import { openShortcutSettings } from '../privacy/browser-permissions';
import { BrowserPrivacySettings } from '../privacy/BrowserPrivacySettings';
import { UpdateSettings } from '../updates/UpdateNotice';
import { workspaceScope } from './state';

const WIDE = '@media (min-width: 680px)';
const categories = [
  { id: 'general', title: '通用', description: '外观与浏览器快捷键' },
  { id: 'conversation', title: '对话偏好', description: '回复指令与背景' },
  { id: 'notifications', title: '通知', description: '任务提醒与最近通知' },
  { id: 'privacy', title: '隐私与数据', description: '浏览器访问与附件草稿' },
  { id: 'updates', title: '关于与更新', description: '版本与安装方式' },
];
function selectedCategory(value: string | null) {
  return categories.some((item) => item.id === value) || value === 'account' ? value : null;
}
const styles = stylex.create({
  layout: {
    display: 'grid',
    gridTemplateColumns: { default: '1fr', [WIDE]: '180px minmax(0, 1fr)' },
    gap: 24,
    alignItems: 'start',
  },
  navigation: { display: 'grid', gap: 6 },
  narrowHidden: { display: { default: 'none', [WIDE]: 'grid' } },
  back: { display: { default: 'block', [WIDE]: 'none' } },
  item: {
    width: '100%',
    justifyContent: 'space-between',
    height: 'auto',
    minHeight: 64,
    paddingBlock: 12,
    textAlign: 'start',
  },
  selected: { backgroundColor: composer.background },
  itemText: { minWidth: 0, flex: 1, whiteSpace: 'normal', lineHeight: 1.4 },
  caption: { display: 'block', color: composer.hint, fontSize: 12, fontWeight: 400, marginTop: 4 },
  detail: { minWidth: 0, display: 'grid', gap: 20 },
  hidden: { display: 'none' },
  identity: { borderBottom: '1px solid', borderColor: composer.border, paddingBottom: 16 },
  settings: {
    display: 'grid',
    alignContent: 'start',
    gap: 24,
    paddingBlock: '8px 24px',
    minHeight: 0,
  },
  heading: { fontSize: 20, margin: 0 },
  detailHeading: {
    justifySelf: 'start',
    outlineStyle: 'none',
    textDecorationLine: { default: 'none', ':focus-visible': 'underline' },
    textDecorationColor: composer.hint,
    textDecorationThickness: 1,
    textUnderlineOffset: 6,
  },
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
  const [params, setParams] = useSearchParams();
  const selected = params.get('section');
  const active = selectedCategory(selected);
  const detailTitleRef = useRef<HTMLHeadingElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const previousCategoryRef = useRef<string | null>(null);
  const [shortcutError, setShortcutError] = useState('');
  useEffect(() => {
    if (active) detailTitleRef.current?.focus();
    else if (previousCategoryRef.current === 'account') accountButtonRef.current?.focus();
    else if (previousCategoryRef.current)
      navigationRef.current
        ?.querySelector<HTMLButtonElement>(`[data-category="${previousCategoryRef.current}"]`)
        ?.focus();
    previousCategoryRef.current = active;
  }, [active]);
  const select = (section: string | null) => {
    const next = new URLSearchParams(params);
    if (section) next.set('section', section);
    else next.delete('section');
    setParams(next);
  };
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
      <div {...stylex.props(styles.identity)}>
        <Button
          ref={accountButtonRef}
          variant="ghost"
          onClick={() => select('account')}
          {...stylex.props(styles.item)}
        >
          <span {...stylex.props(styles.itemText)}>
            {account.account?.user.name ?? account.account?.user.email ?? '登录 Lody'}
            <span {...stylex.props(styles.caption)}>
              {account.error ? '账户连接需要处理' : (account.workspace?.name ?? '账户与工作区')}
            </span>
          </span>
          <span aria-hidden="true">›</span>
        </Button>
      </div>
      <div {...stylex.props(styles.layout)}>
        <nav
          ref={navigationRef}
          aria-label="设置分类"
          {...stylex.props(styles.navigation, !!active && styles.narrowHidden)}
        >
          {categories.map((item) => (
            <Button
              key={item.id}
              data-category={item.id}
              variant="ghost"
              aria-current={(active ?? 'general') === item.id ? 'page' : undefined}
              onClick={() => select(item.id)}
              {...stylex.props(styles.item, (active ?? 'general') === item.id && styles.selected)}
            >
              <span {...stylex.props(styles.itemText)}>
                {item.title}
                <span {...stylex.props(styles.caption)}>{item.description}</span>
              </span>
              <span aria-hidden="true">›</span>
            </Button>
          ))}
        </nav>
        <div {...stylex.props(styles.detail, !active && styles.narrowHidden)}>
          <div {...stylex.props(styles.back)}>
            <Button variant="ghost" size="small" onClick={() => select(null)}>
              返回设置
            </Button>
          </div>
          <h3
            ref={detailTitleRef}
            tabIndex={-1}
            {...stylex.props(styles.heading, styles.detailHeading)}
          >
            {active === 'account'
              ? '账户与工作区'
              : categories.find((item) => item.id === (active ?? 'general'))?.title}
          </h3>
          <div {...stylex.props(active !== 'account' && styles.hidden)}>
            <AccountPage />
          </div>
          <div {...stylex.props(active !== 'conversation' && styles.hidden)}>
            <BrowserPrivacySettings section="conversation" {...(scope ? { scope } : {})} />
          </div>
          <div {...stylex.props(active !== 'privacy' && styles.hidden)}>
            <BrowserPrivacySettings {...(scope ? { scope } : {})} />
          </div>
          <div {...stylex.props(active !== 'notifications' && styles.hidden)}>
            <NotificationSettings key={scope ?? 'signed-out'} />
          </div>
          <div {...stylex.props(active !== 'updates' && styles.hidden)}>
            <UpdateSettings />
          </div>
          <section
            {...stylex.props(styles.section, (active ?? 'general') !== 'general' && styles.hidden)}
            aria-label="外观"
          >
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
            <Button
              variant="secondary"
              onClick={() => {
                setShortcutError('');
                void openShortcutSettings().catch((reason: Error) =>
                  setShortcutError(reason.message),
                );
              }}
            >
              设置浏览器快捷键
            </Button>
            {shortcutError && <p role="alert">{shortcutError}</p>}
          </section>
        </div>
      </div>
    </section>
  );
}
