import { Switch } from '@base-ui/react/switch';
import * as stylex from '@stylexjs/stylex';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import * as m from 'motion/react-m';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useForm, useFormState } from 'react-hook-form';
import { NavLink, Route, Routes } from 'react-router';

import type { Preferences } from '../features/preferences/model';
import { moods } from '../features/preferences/model';
import { preferencesAtom } from '../features/preferences/state';
import {
  loadPreferences,
  savePreferences,
  watchPreferences,
} from '../features/preferences/storage';
import { Icon } from '../shared/icons/Icon';
import { tokens } from '../shared/theme/tokens.stylex';

const Ambient = lazy(() =>
  import('../features/ambient/Ambient').then((module) => ({ default: module.Ambient })),
);
const Introduction = lazy(() =>
  import('../features/introduction/Introduction').then((module) => ({
    default: module.Introduction,
  })),
);
const styles = stylex.create({
  shell: {
    maxWidth: 680,
    marginInline: 'auto',
    padding: 24,
    position: 'relative',
    isolation: 'isolate',
  },
  header: { display: 'flex', alignItems: 'center', gap: 12 },
  nav: { display: 'flex', gap: 20, marginBlock: 20 },
  card: {
    padding: 20,
    backgroundColor: tokens.surface,
    borderRadius: tokens.radius,
    border: '1px solid #d8dce2',
  },
  row: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  button: {
    border: '1px solid #687384',
    borderRadius: 8,
    backgroundColor: '#fff',
    color: '#20252b',
    paddingInline: 12,
  },
  selected: { backgroundColor: '#244e96', color: '#fff', borderColor: '#244e96' },
  form: { display: 'grid', gap: 12 },
  input: { width: '100%', borderRadius: 8, border: '1px solid #687384', padding: 10 },
  switch: {
    width: 48,
    height: 28,
    padding: 2,
    border: '1px solid #687384',
    borderRadius: 20,
    backgroundColor: '#e5e7eb',
  },
  thumb: {
    display: 'block',
    height: 22,
    width: 22,
    borderRadius: '50%',
    backgroundColor: '#244e96',
    transform: { default: 'translateX(0)', ':is([data-checked] *)': 'translateX(18px)' },
  },
});

export function App() {
  const [preferences, setPreferences] = useAtom(preferencesAtom);
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['preferences'], queryFn: loadPreferences });
  const [saveError, setSaveError] = useState('');
  const mutation = useMutation({
    mutationFn: savePreferences,
    onSuccess: (_, value) => {
      setPreferences(value);
      queryClient.setQueryData(['preferences'], value);
      setSaveError('');
    },
    onError: () => setSaveError('Could not save your preferences. Please try again.'),
  });
  useEffect(() => {
    if (query.data) setPreferences(query.data);
  }, [query.data, setPreferences]);
  useEffect(
    () =>
      watchPreferences((value) => {
        setPreferences(value);
        queryClient.setQueryData(['preferences'], value);
      }),
    [queryClient, setPreferences],
  );
  if (query.isPending)
    return (
      <main {...stylex.props(styles.shell)} aria-busy="true">
        Loading workspace…
      </main>
    );
  if (query.isError)
    return (
      <main {...stylex.props(styles.shell)}>
        <p role="alert">Could not load preferences.</p>
        <button type="button" onClick={() => void query.refetch()}>
          Retry
        </button>
      </main>
    );
  const update = (value: Preferences) => mutation.mutate(value);
  return (
    <main {...stylex.props(styles.shell)} data-mood={preferences.mood}>
      {preferences.ambient && (
        <Suspense fallback={null}>
          <Ambient />
        </Suspense>
      )}
      <header {...stylex.props(styles.header)}>
        <Icon />
        <h1>Lody</h1>
      </header>
      <nav aria-label="Main" {...stylex.props(styles.nav)}>
        <NavLink to="/">Workspace</NavLink>
        <NavLink to="/settings">Settings</NavLink>
        <NavLink to="/intro">Intro</NavLink>
      </nav>
      {saveError && <p role="alert">{saveError}</p>}
      <Routes>
        <Route
          path="/"
          element={
            <section {...stylex.props(styles.card)}>
              <h2>{preferences.displayName}</h2>
              <p>Choose the mood of your workspace.</p>
              <fieldset aria-label="Icon mood" {...stylex.props(styles.row)}>
                {moods.map((mood) => (
                  <m.button
                    key={mood}
                    type="button"
                    aria-pressed={preferences.mood === mood}
                    disabled={mutation.isPending}
                    {...stylex.props(styles.button, preferences.mood === mood && styles.selected)}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => update({ ...preferences, mood })}
                  >
                    {mood}
                  </m.button>
                ))}
              </fieldset>
            </section>
          }
        />
        <Route
          path="/settings"
          element={
            <Settings preferences={preferences} onSave={update} pending={mutation.isPending} />
          }
        />
        <Route
          path="/intro"
          element={
            <Suspense fallback={<p>Loading introduction…</p>}>
              <Introduction />
            </Suspense>
          }
        />
        <Route
          path="*"
          element={
            <section>
              <h2>Page not found</h2>
              <NavLink to="/">Back to workspace</NavLink>
            </section>
          }
        />
      </Routes>
    </main>
  );
}

function Settings({
  preferences,
  onSave,
  pending,
}: {
  preferences: Preferences;
  onSave: (value: Preferences) => void;
  pending: boolean;
}) {
  'use no memo';
  // RHF subscribes through proxy reads; compiler caching can freeze isDirty and disable saving.
  const { register, handleSubmit, control, reset } = useForm<{ displayName: string }>({
    defaultValues: { displayName: preferences.displayName },
  });
  const { errors, isDirty } = useFormState({ control });
  useEffect(() => {
    reset({ displayName: preferences.displayName });
  }, [preferences.displayName, reset]);
  return (
    <section {...stylex.props(styles.card)}>
      <h2>Settings</h2>
      <form
        {...stylex.props(styles.form)}
        onSubmit={handleSubmit((data) =>
          onSave({ ...preferences, displayName: data.displayName.trim() }),
        )}
      >
        <label htmlFor="display-name">Workspace name</label>
        <input
          id="display-name"
          type="text"
          aria-invalid={!!errors.displayName}
          aria-describedby={errors.displayName ? 'name-error' : undefined}
          {...stylex.props(styles.input)}
          {...register('displayName', {
            required: 'Enter a workspace name.',
            maxLength: { value: 40, message: 'Use 40 characters or fewer.' },
            validate: (value) => value.trim().length > 0 || 'Enter a workspace name.',
          })}
        />
        {errors.displayName && (
          <p id="name-error" role="alert">
            {errors.displayName.message}
          </p>
        )}
        <button type="submit" disabled={pending || !isDirty} {...stylex.props(styles.button)}>
          Save name
        </button>
      </form>
      <div {...stylex.props(styles.row)} style={{ marginTop: 20 }}>
        <label htmlFor="ambient">Ambient effects</label>
        <Switch.Root
          id="ambient"
          checked={preferences.ambient}
          disabled={pending}
          onCheckedChange={(ambient) => onSave({ ...preferences, ambient })}
          {...stylex.props(styles.switch)}
        >
          <Switch.Thumb {...stylex.props(styles.thumb)} />
        </Switch.Root>
      </div>
      <p>Effects respect your device’s Reduce Motion setting.</p>
    </section>
  );
}
