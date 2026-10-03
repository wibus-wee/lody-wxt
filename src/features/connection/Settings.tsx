import { colors } from '@lody/ui/tokens/colors.stylex';
import { text } from '@lody/ui/tokens/scales.stylex';
import * as stylex from '@stylexjs/stylex';
import { useEffect } from 'react';
import { useForm, useFormState } from 'react-hook-form';

import { Alert, Button, Field, Input, Select, Switch } from '../../shared/ui';
import type { Preferences } from '../preferences/model';
import { moods } from '../preferences/model';
import { connectionBlocker } from './client';

const styles = stylex.create({
  settings: {
    overflowY: 'auto',
    display: 'grid',
    alignContent: 'start',
    gap: 24,
    paddingBlock: 20,
    minHeight: 0,
  },
  form: { display: 'grid', gap: 12 },
  moods: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  row: { display: 'flex', alignItems: 'center', gap: 12 },
  introduction: { display: 'grid', gap: 6 },
  heading: { margin: 0, fontSize: text.titleSize, lineHeight: text.titleLeading },
  description: {
    margin: 0,
    color: colors.secondaryLabel,
    fontSize: text.footnoteSize,
    lineHeight: text.footnoteLeading,
  },
});
const themes = [
  { value: 'system', label: 'system' },
  { value: 'light', label: 'light' },
  { value: 'dark', label: 'dark' },
];
const modes = [
  { value: 'demo', label: '演示模式' },
  { value: 'real', label: '真实 Lody（待集成）' },
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
  // RHF's proxy subscription must observe every render's isDirty read.
  const { register, handleSubmit, control, reset } = useForm<{
    displayName: string;
    workspaceId: string;
  }>({
    defaultValues: { displayName: preferences.displayName, workspaceId: preferences.workspaceId },
  });
  const { errors, isDirty } = useFormState({ control });
  useEffect(() => {
    reset({ displayName: preferences.displayName, workspaceId: preferences.workspaceId });
  }, [preferences.displayName, preferences.workspaceId, reset]);
  return (
    <section {...stylex.props(styles.settings)} aria-label="Settings">
      <div {...stylex.props(styles.introduction)}>
        <h2 {...stylex.props(styles.heading)}>设置</h2>
        <p {...stylex.props(styles.description)}>管理工作区、连接与外观。</p>
      </div>
      <form
        {...stylex.props(styles.form)}
        onSubmit={handleSubmit((value) =>
          onSave({
            ...preferences,
            displayName: value.displayName.trim(),
            workspaceId: value.workspaceId.trim(),
          }),
        )}
      >
        <Field.Root invalid={!!errors.displayName}>
          <Field.Label htmlFor="display-name">Workspace name</Field.Label>
          <Input
            id="display-name"
            {...register('displayName', {
              required: 'Enter a workspace name.',
              maxLength: { value: 40, message: 'Use 40 characters or fewer.' },
              validate: (value) => !!value.trim() || 'Enter a workspace name.',
            })}
          />
        </Field.Root>
        {errors.displayName && (
          <Alert.Root tone="danger">
            <Alert.Description>{errors.displayName.message}</Alert.Description>
          </Alert.Root>
        )}
        <Field.Root>
          <Field.Label htmlFor="workspace-id">Lody 工作区 ID</Field.Label>
          <Input id="workspace-id" maxLength={200} {...register('workspaceId')} />
          <Field.Description>真实连接所需的工作区标识；不会读取其他应用的凭据。</Field.Description>
        </Field.Root>
        <Button type="submit" disabled={pending || !isDirty}>
          Save name
        </Button>
      </form>
      <Field.Root disabled={pending}>
        <Field.Label>连接模式</Field.Label>
        <Select.Root
          items={modes}
          value={preferences.mode}
          onValueChange={(mode) => {
            if (mode === 'demo' || mode === 'real') onSave({ ...preferences, mode });
          }}
        >
          <Select.Trigger>
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {modes.map((item) => (
              <Select.Item key={item.value} value={item.value}>
                {item.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Field.Root>
      {preferences.mode === 'demo' ? (
        <Alert.Root>
          <Alert.Title>演示模式</Alert.Title>
          <Alert.Description>会话与流式回复在本地生成。数据和真实账户隔离。</Alert.Description>
        </Alert.Root>
      ) : (
        <Alert.Root tone="warning">
          <Alert.Title>真实 Lody 未连接</Alert.Title>
          <Alert.Description>{connectionBlocker}</Alert.Description>
        </Alert.Root>
      )}
      <Field.Root disabled={pending}>
        <Field.Label>Theme</Field.Label>
        <Select.Root
          items={themes}
          value={preferences.theme}
          onValueChange={(theme) => {
            if (theme === 'light' || theme === 'dark' || theme === 'system')
              onSave({ ...preferences, theme });
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
      <fieldset aria-label="Icon mood">
        <legend>Icon mood</legend>
        <div {...stylex.props(styles.moods)}>
          {moods.map((mood) => (
            <Button
              key={mood}
              variant={preferences.mood === mood ? 'primary' : 'secondary'}
              size="small"
              aria-pressed={preferences.mood === mood}
              disabled={pending}
              onClick={() => onSave({ ...preferences, mood })}
            >
              {mood}
            </Button>
          ))}
        </div>
      </fieldset>
      <Field.Root disabled={pending}>
        <div {...stylex.props(styles.row)}>
          <Field.Label htmlFor="auto-project">匹配 GitHub 会话项目</Field.Label>
          <Switch
            id="auto-project"
            checked={preferences.autoProject}
            onCheckedChange={(autoProject) => onSave({ ...preferences, autoProject })}
          />
        </div>
        <Field.Description>
          仅在主动附加 GitHub 页面后，匹配机器目录中已有仓库。演示目录包含
          LodyAI/lody；真实目录待认证后接入。
        </Field.Description>
      </Field.Root>
      <Field.Root disabled={pending}>
        <div {...stylex.props(styles.row)}>
          <Field.Label htmlFor="ambient">Ambient effects</Field.Label>
          <Switch
            id="ambient"
            checked={preferences.ambient}
            onCheckedChange={(ambient) => onSave({ ...preferences, ambient })}
          />
        </div>
        <Field.Description>Effects respect your device’s Reduce Motion setting.</Field.Description>
      </Field.Root>
      <p>首版不执行网页操作、文件写入或权限自动批准。</p>
    </section>
  );
}
