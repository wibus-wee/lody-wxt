import * as stylex from '@stylexjs/stylex';

import { ActivityStatus } from '../../shared/ui/ActivityStatus';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { Field } from '../../shared/ui/field';
import { Select } from '../../shared/ui/select';
import { useAccount } from './useAccount';

const styles = stylex.create({
  form: { display: 'grid', gap: 12 },
  row: { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' },
  code: { fontSize: 28, letterSpacing: '0.12em', overflowWrap: 'anywhere' },
  link: { overflowWrap: 'anywhere', whiteSpace: 'normal', textAlign: 'start' },
});

export function AccountPage() {
  const account = useAccount();
  const busy = new Set(['loading', 'requesting', 'authorizing', 'validating']).has(account.status);
  return (
    <Card.Root>
      <Card.Header>
        <Card.Title as="h2" id="account-title">
          Lody 账户
        </Card.Title>
        <Card.Description>登录后即可在侧栏与 Lody 对话。</Card.Description>
      </Card.Header>
      {busy && (
        <ActivityStatus busy>
          {account.status === 'authorizing' ? '等待登录确认' : '连接账户'}
        </ActivityStatus>
      )}
      {account.error && (
        <Alert.Root tone="danger">
          <Alert.Description>
            {account.errorContext?.operation === 'account'
              ? '无法验证账户'
              : account.errorContext?.operation === 'workspaces'
                ? '无法加载工作区'
                : account.errorContext?.operation === 'device_code'
                  ? '无法请求设备授权码'
                  : account.errorContext?.operation === 'device_token'
                    ? '无法完成设备授权'
                    : account.errorContext?.operation === 'session'
                      ? '无法验证登录会话'
                      : account.errorContext?.operation === 'storage'
                        ? '无法保存账户状态'
                        : '登录失败'}
            。错误代码：{account.error}。
          </Alert.Description>
        </Alert.Root>
      )}
      {account.authorization && (
        <Alert.Root>
          <Alert.Title>在登录页面确认这组授权码：</Alert.Title>
          <p {...stylex.props(styles.code)}>
            <code>{account.authorization.code.user_code}</code>
          </p>
          <Alert.Actions>
            <Button
              variant="link"
              nativeButton={false}
              {...stylex.props(styles.link)}
              render={
                <a
                  {...{ role: 'link' }}
                  aria-label={account.authorization.code.verification_uri}
                  href={account.authorization.code.verification_uri_complete}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              {account.authorization.code.verification_uri}
            </Button>
          </Alert.Actions>
          <Alert.Description>
            有效期至 {new Date(account.authorization.expiresAtMs).toLocaleTimeString()}.
          </Alert.Description>
        </Alert.Root>
      )}
      {account.account && (
        <div {...stylex.props(styles.form)}>
          <p>已登录：{account.account.user.name ?? account.account.user.email}</p>
          <Field.Root>
            <Field.Label id="account-workspace-label" htmlFor="account-workspace">
              工作区
            </Field.Label>
            <Select.Root
              value={account.workspace?.id ?? null}
              items={account.workspaces.map((workspace) => ({
                value: workspace.id,
                label: workspace.name,
              }))}
              onValueChange={(value) => {
                if (value !== null) void account.selectWorkspace(value);
              }}
            >
              <Select.Trigger id="account-workspace" aria-labelledby="account-workspace-label">
                <Select.Value placeholder="选择工作区" />
              </Select.Trigger>
              <Select.Content>
                {account.workspaces.map((workspace) => (
                  <Select.Item key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Field.Root>
          {account.workspaces.length === 0 && <p>此账户还没有可用工作区，请先在 Lody 中创建。</p>}
        </div>
      )}
      <div {...stylex.props(styles.row)}>
        {account.canRetryRestore && (
          <Button disabled={busy} onClick={() => void account.retryValidation()}>
            重试登录验证
          </Button>
        )}
        {!account.account && !account.canRetryRestore && (
          <Button disabled={!account.config || busy} onClick={() => void account.login()}>
            登录 Lody
          </Button>
        )}
        {busy && account.status !== 'loading' && (
          <Button variant="secondary" onClick={() => void account.cancel()}>
            取消登录
          </Button>
        )}
        {account.account && (
          <Button variant="secondary" onClick={() => void account.logout()}>
            退出此设备
          </Button>
        )}
      </div>
    </Card.Root>
  );
}
