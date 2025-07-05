import { spawn } from '@malept/cross-spawn-promise';
import findUp from 'find-up';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SupportedPackageManager, resolvePackageManager, spawnPackageManager } from '../src/package-manager';

vi.mock('@malept/cross-spawn-promise');
vi.mock('find-up', async (importOriginal) => {
  const mod = await importOriginal<object>();
  return {
    ...mod,
    default: vi.fn(),
  };
});

describe('package-manager', () => {
  describe('npm_config_user_agent', () => {
    beforeAll(() => {
      const originalUa = process.env.npm_config_user_agent;

      return () => {
        process.env.npm_config_user_agent = originalUa;
      };
    });

    it.each([
      { ua: 'yarn/1.22.22 npm/? node/v22.13.0 darwin arm64', pm: 'yarn', version: '1.22.22' },
      { ua: 'pnpm/10.0.0 npm/? node/v20.11.1 darwin arm64', pm: 'pnpm', version: '10.0.0' },
      { ua: 'npm/10.9.2 node/v22.13.0 darwin arm64 workspaces/false', pm: 'npm', version: '10.9.2' },
      { ua: 'bun/1.2.17 npm/? node/v22.6.0 darwin x64', pm: 'bun', version: '1.2.17' },
    ])('with $ua', async ({ ua, pm, version }) => {
      process.env.npm_config_user_agent = ua;
      await expect(resolvePackageManager()).resolves.toHaveProperty('executable', pm);
      await expect(resolvePackageManager()).resolves.toHaveProperty('version', version);
    });

    it('should return yarn if npm_config_user_agent=yarn', async () => {
      process.env.npm_config_user_agent = 'yarn/1.22.22 npm/? node/v22.13.0 darwin arm64';
      await expect(resolvePackageManager()).resolves.toHaveProperty('executable', 'yarn');
      await expect(resolvePackageManager()).resolves.toHaveProperty('version', '1.22.22');
    });

    it('should return pnpm if npm_config_user_agent=pnpm', async () => {
      process.env.npm_config_user_agent = 'pnpm/10.0.0 npm/? node/v20.11.1 darwin arm64';
      await expect(resolvePackageManager()).resolves.toHaveProperty('executable', 'pnpm');
    });

    it('should return npm if npm_config_user_agent=npm', async () => {
      process.env.npm_config_user_agent = 'npm/10.9.2 node/v22.13.0 darwin arm64 workspaces/false';
      await expect(resolvePackageManager()).resolves.toHaveProperty('executable', 'npm');
    });
  });

  describe('NODE_INSTALLER', () => {
    let initialNodeInstallerValue: string | undefined;

    beforeEach(() => {
      initialNodeInstallerValue = process.env.NODE_INSTALLER;
      delete process.env.NODE_INSTALLER;
      // NODE_INSTALLER is deprecated for Electron Forge 8 and throws a console.warn that we want to silence in tests
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      return () => {
        // For cleanup, we want to restore process.env.NODE_INSTALLER.
        // If it wasn't explicitly set before, we delete the value set during the test.
        // Otherwise, we restore the initial value.
        if (!initialNodeInstallerValue) {
          delete process.env.NODE_INSTALLER;
        } else {
          process.env.NODE_INSTALLER = initialNodeInstallerValue;
        }
        vi.restoreAllMocks();
      };
    });

    it.each([{ pm: 'yarn' }, { pm: 'npm' }, { pm: 'pnpm' }, { pm: 'bun' }])('should return $pm if NODE_INSTALLER=$pm', async ({ pm }) => {
      process.env.NODE_INSTALLER = pm;
      await expect(resolvePackageManager()).resolves.toHaveProperty('executable', pm);
    });

    it('should return npm if package manager is unsupported', async () => {
      process.env.NODE_INSTALLER = 'fun';
      console.warn = vi.fn();
      await expect(resolvePackageManager()).resolves.toHaveProperty('executable', 'npm');
      expect(console.warn).toHaveBeenCalledWith('⚠', expect.stringContaining('Package manager fun is unsupported'));
    });
  });

  describe('spawnPackageManager', () => {
    it('should trim the output', async () => {
      vi.mocked(spawn).mockResolvedValue(' foo \n');
      const result = await spawnPackageManager({
        executable: 'npm',
        install: 'install',
        dev: '--save-dev',
        exact: '--save-exact',
      });
      expect(result).toBe('foo');
    });
  });

  it('should use the package manager for the nearest ancestor lockfile if detected', async () => {
    // save off and unset environment variables so that lockfile resolution (only) is tested
    const oldInstaller = process.env.NODE_INSTALLER;
    delete process.env.NODE_INSTALLER;
    const oldNpmConfigUserAgent = process.env.npm_config_user_agent;
    delete process.env.npm_config_user_agent;

    const cases: Array<{ lockfile: string; expected: SupportedPackageManager }> = [
      { lockfile: 'yarn.lock', expected: 'yarn' },
      { lockfile: 'pnpm-lock.yaml', expected: 'pnpm' },
      { lockfile: 'package-json.lock', expected: 'npm' },
      { lockfile: 'bun.lock', expected: 'bun' },
      { lockfile: 'bun.lockb', expected: 'bun' },
    ];

    for (const { lockfile, expected } of cases) {
      vi.mocked(findUp).mockResolvedValue(`/Users/foo/bar/${lockfile}`);
      await expect(resolvePackageManager()).resolves.toHaveProperty('executable', expected);
    }

    // restore environment variables for other tests
    process.env.NODE_INSTALLER = oldInstaller;
    process.env.npm_config_user_agent = oldNpmConfigUserAgent;
  });

  it('should fall back to npm if no other strategy worked', async () => {
    process.env.npm_config_user_agent = undefined;
    vi.mocked(findUp).mockResolvedValue(undefined);
    await expect(resolvePackageManager()).resolves.toHaveProperty('executable', 'npm');
  });
});
