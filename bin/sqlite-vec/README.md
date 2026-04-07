## sqlite-vec Dynamic Libraries

将 `sqlite-vec` 的平台二进制放在这个目录下，应用会在运行时自动加载。

目录约定：

- `bin/sqlite-vec/darwin-arm64/vec0.dylib`
- `bin/sqlite-vec/darwin-x64/vec0.dylib`
- `bin/sqlite-vec/linux-x64/vec0.so`
- `bin/sqlite-vec/win32-x64/vec0.dll`

当前代码会按以下顺序查找扩展：

1. 环境变量 `META_PLAYER_SQLITE_VEC_PATH`
2. 仓库内 `bin/sqlite-vec/<platform>-<arch>/vec0.*`
3. 打包产物中的 `resources/sqlite-vec/vec0.*`

如果没有找到扩展，应用仍可启动，但剧情搜索会回退到非 `sqlite-vec` 路径。
