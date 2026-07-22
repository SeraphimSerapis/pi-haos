#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/landlock.h>
#include <linux/prctl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

#ifndef LANDLOCK_ACCESS_FS_REFER
#define LANDLOCK_ACCESS_FS_REFER (1ULL << 13)
#endif
#ifndef LANDLOCK_ACCESS_NET_CONNECT_TCP
#define LANDLOCK_ACCESS_NET_CONNECT_TCP (1ULL << 0)
#endif
#ifndef LANDLOCK_CREATE_RULESET_VERSION
#define LANDLOCK_CREATE_RULESET_VERSION (1ULL << 0)
#endif
#ifndef LANDLOCK_RULE_NET_PORT
#define LANDLOCK_RULE_NET_PORT 2
#endif

/* These layouts are stable kernel UAPI structs, but older libc headers may
 * not declare them yet. Keep local declarations so the multi-arch builder can
 * compile against an older linux-libc-dev while still probing ABI 4 at run time. */
struct pi_landlock_ruleset_attr {
  __u64 handled_access_fs;
  __u64 handled_access_net;
};
struct pi_landlock_net_port_attr {
  __u64 allowed_access;
  __u64 port;
};

static int landlock_create(const struct landlock_ruleset_attr *attr, size_t size, __u32 flags) {
  return (int)syscall(__NR_landlock_create_ruleset, attr, size, flags);
}
static int landlock_add_path(int ruleset, const char *path, __u64 access) {
  int fd = open(path, O_PATH | O_CLOEXEC);
  if (fd < 0) return -1;
  struct landlock_path_beneath_attr rule = { .parent_fd = fd, .allowed_access = access };
  int result = (int)syscall(__NR_landlock_add_rule, ruleset, LANDLOCK_RULE_PATH_BENEATH, &rule, 0);
  close(fd);
  return result;
}
static int landlock_add_port(int ruleset, unsigned short port) {
  struct pi_landlock_net_port_attr rule = { .allowed_access = LANDLOCK_ACCESS_NET_CONNECT_TCP, .port = port };
  return (int)syscall(__NR_landlock_add_rule, ruleset, LANDLOCK_RULE_NET_PORT, &rule, 0);
}

static void fail(const char *message) {
  fprintf(stderr, "pi-sandbox: %s (%s)\n", message, strerror(errno));
  _exit(126);
}

int main(int argc, char **argv) {
  const char *workspace = NULL;
  unsigned short broker_port = 0;
  int command_index = -1;
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--workspace") == 0 && i + 1 < argc) workspace = argv[++i];
    else if (strcmp(argv[i], "--broker-port") == 0 && i + 1 < argc) broker_port = (unsigned short)strtoul(argv[++i], NULL, 10);
    else if (strcmp(argv[i], "--") == 0) { command_index = i + 1; break; }
  }
  if (!workspace || command_index < 0 || command_index >= argc) fail("workspace and command are required");

  /* Refuse to run unless the kernel supports the filesystem and network ABI. */
  if (landlock_create(NULL, 0, LANDLOCK_CREATE_RULESET_VERSION) < 4) fail("Landlock ABI 4 is required");
  const __u64 fs_access = LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_WRITE_FILE |
    LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR | LANDLOCK_ACCESS_FS_REMOVE_DIR |
    LANDLOCK_ACCESS_FS_REMOVE_FILE | LANDLOCK_ACCESS_FS_MAKE_CHAR | LANDLOCK_ACCESS_FS_MAKE_DIR |
    LANDLOCK_ACCESS_FS_MAKE_REG | LANDLOCK_ACCESS_FS_MAKE_SOCK | LANDLOCK_ACCESS_FS_MAKE_FIFO |
    LANDLOCK_ACCESS_FS_MAKE_BLOCK | LANDLOCK_ACCESS_FS_MAKE_SYM | LANDLOCK_ACCESS_FS_REFER;
  struct pi_landlock_ruleset_attr ruleset_attr = { .handled_access_fs = fs_access, .handled_access_net = LANDLOCK_ACCESS_NET_CONNECT_TCP };
  int ruleset = landlock_create(&ruleset_attr, sizeof(ruleset_attr), 0);
  if (ruleset < 0) fail("cannot create Landlock ruleset");

  const __u64 read_only = LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR;
  if (landlock_add_path(ruleset, "/app", read_only) < 0) fail("cannot allow runtime files");
  if (landlock_add_path(ruleset, "/usr", read_only) < 0) fail("cannot allow system libraries");
  if (landlock_add_path(ruleset, "/lib", read_only) < 0) fail("cannot allow libraries");
  if (landlock_add_path(ruleset, "/lib64", read_only) < 0 && errno != ENOENT) fail("cannot allow libraries");
  if (landlock_add_path(ruleset, "/etc", read_only) < 0) fail("cannot allow system configuration");
  if (landlock_add_path(ruleset, "/dev", read_only) < 0) fail("cannot allow device endpoints");
  if (landlock_add_path(ruleset, "/tmp", fs_access) < 0) fail("cannot allow temporary files");
  if (landlock_add_path(ruleset, workspace, fs_access) < 0) fail("cannot allow session workspace");
  if (broker_port && landlock_add_port(ruleset, broker_port) < 0) fail("cannot allow inference broker");
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) < 0) fail("cannot set no-new-privileges");
  if (syscall(__NR_landlock_restrict_self, ruleset, 0) < 0) fail("cannot enforce Landlock ruleset");
  close(ruleset);
  clearenv();
  setenv("PATH", "/usr/local/bin:/usr/bin:/bin", 1);
  setenv("HOME", workspace, 1);
  execvp(argv[command_index], &argv[command_index]);
  fail("cannot execute Pi");
  return 126;
}
