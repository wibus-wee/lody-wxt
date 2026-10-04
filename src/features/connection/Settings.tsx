import * as stylex from '@stylexjs/stylex';
import { useEffect } from 'react';
import { useForm, useFormState } from 'react-hook-form';
import { NavLink } from 'react-router';
import * as v from 'valibot';

import { Button, Field, Input, Select, Switch } from '../../shared/ui';
import { composer } from '../../shared/ui/composer.stylex';
import { AccountPage } from '../account/AccountPage';
import type { Preferences } from '../preferences/model';
import { moods } from '../preferences/model';

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
  moods: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  links: { display: 'flex', flexWrap: 'wrap', gap: 4 },
});
const themes = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];
const moodNames = { outline: '线条', duotone: '双色', fill: '实心', pixel: '像素', glass: '玻璃' };

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
  const { register, handleSubmit, control, reset } = useForm<{ displayName: string }>({
    defaultValues: { displayName: preferences.displayName },
  });
  const { errors, isDirty } = useFormState({ control });
  useEffect(() => {
    reset({ displayName: preferences.displayName });
  }, [preferences.displayName, reset]);
  return (
    <section {...stylex.props(styles.settings)} aria-label="Settings">
      <div {...stylex.props(styles.row)}>
        <h2 {...stylex.props(styles.heading)}>设置</h2>
        <Button variant="ghost" size="small" nativeButton={false} render={<NavLink to="/" />}>
          返回对话
        </Button>
      </div>
      <AccountPage />
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
        <Field.Root>
          <Field.Label>图标风格</Field.Label>
          <div {...stylex.props(styles.moods)}>
            {moods.map((mood) => (
              <Button
                key={mood}
                variant={preferences.mood === mood ? 'primary' : 'secondary'}
                size="small"
                aria-label={mood}
                aria-pressed={preferences.mood === mood}
                disabled={pending}
                onClick={() => onSave({ ...preferences, mood })}
              >
                {moodNames[mood]}
              </Button>
            ))}
          </div>
        </Field.Root>
        <Field.Root disabled={pending}>
          <div {...stylex.props(styles.row)}>
            <Field.Label htmlFor="ambient">氛围效果</Field.Label>
            <Switch
              id="ambient"
              checked={preferences.ambient}
              onCheckedChange={(ambient) => onSave({ ...preferences, ambient })}
            />
          </div>
          <Field.Description>跟随系统的减少动态效果设置。</Field.Description>
        </Field.Root>
        <form
          noValidate
          {...stylex.props(styles.form)}
          onSubmit={handleSubmit((value) =>
            onSave({ ...preferences, displayName: value.displayName.trim() }),
          )}
        >
          <Field.Root invalid={!!errors.displayName}>
            <Field.Label htmlFor="display-name">侧栏名称</Field.Label>
            <Input
              id="display-name"
              {...register('displayName', {
                required: '请输入侧栏名称。',
                maxLength: { value: 40, message: '名称最多 40 个字符。' },
                validate: (value) => !!value.trim() || '请输入侧栏名称。',
              })}
            />
            {errors.displayName && (
              <Field.Error match role="alert">
                {errors.displayName.message}
              </Field.Error>
            )}
          </Field.Root>
          <Button type="submit" size="small" variant="secondary" disabled={pending || !isDirty}>
            保存名称
          </Button>
        </form>
      </section>
      <div {...stylex.props(styles.links)}>
        <Button
          variant="ghost"
          size="small"
          nativeButton={false}
          aria-label="Intro"
          render={<NavLink to="/intro" />}
        >
          使用指南
        </Button>
        <Button
          variant="ghost"
          size="small"
          nativeButton={false}
          render={<NavLink to="/workspace" />}
        >
          高级工作区
        </Button>
      </div>
    </section>
  );
}
