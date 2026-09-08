# Instalacion local Linux (AppImage en /opt/orca)

Preparacion para ejecutar **el mismo** binario desde un terminal **fuera de Orca**.
Esta pagina no instala nada. El artefacto de la release todavia puede no existir:
no reutilices un hash viejo.

## Quien puede aplicar

- Linux, root, y `--confirm=INSTALL`.
- Sesion **fuera** del cgroup `orca-server.service` y **fuera** del entorno Orca
  (`ORCA_PANE_KEY`, `ORCA_OPENCODE_CONFIG_DIR` y `ORCA_TERMINAL_HANDLE` vacios).
  `sudo` desde un PTY de Orca no vale: el proceso sigue en el mismo cgroup y el
  script se niega.
- No hay flag de bypass.

Un `systemctl restart orca-server.service` mata todo el cgroup (coordinador,
workers, PTYs). Ver `release-preflight-197-2.md` seccion 2.

## Comando plantilla

Calcula el SHA-256 **despues** de construir el AppImage nuevo:

```bash
sha256sum /path/to/orca-linux.AppImage
```

Luego, desde SSH o consola (no desde Orca):

```bash
sudo bash config/scripts/install-local-linux-release.sh \
  --artifact /path/to/orca-linux.AppImage \
  --version vX.Y.Z-kukapu.N \
  --sha256 HEX \
  --apply --confirm=INSTALL
```

Sustituye PATH, VER y HEX. VER debe parecer `v1.2.3` o `v1.2.3-kukapu.N`.
No copies un hash de una build anterior.

Inspeccion sin mutar:

```bash
bash config/scripts/install-local-linux-release.sh \
  --artifact /path/to/orca-linux.AppImage \
  --version vX.Y.Z-kukapu.N \
  --sha256 HEX \
  --preflight
```

`--dry-run` imprime el mismo plan (backup, stage, swap, restart, health) sin escribir.

## Que hace apply

1. Verifica hash y ELF **antes** de tocar `/opt/orca`.
2. Toma `/opt/orca/install.lock` (`flock`); si hay otro instalador, aborta.
3. Copia de seguridad del binario **y** de `VERSION` con el mismo sello UTC unico
   en `/opt/orca/backups/` y verifica esas copias. No borra backups.
4. Stage unico (`.stage.<stamp>.<pid>`) en el mismo filesystem; vuelve a hashear
   el binario staged contra `--sha256` antes del `mv`.
5. `mv` binario y `VERSION`. Si el segundo falla (o el hash final no coincide),
   intenta restaurar **ambos** desde los backups y no reinicia. Si una de las
   dos restauraciones falla, lo declara (`Restore incomplete`) y no afirma que
   el par quedo coherente.
6. Solo entonces `systemctl reset-failed` + restart de `orca-xvfb.service` y
   `orca-server.service`. No modifica units, shims ni el puerto 6768.
7. Salud: espera hasta 30 s a `is-active` de ambas unidades y a `:6768`.
   El veredicto no es un `sleep` fijo. No imprime pairing, tokens ni journal.

## Rollback manual

```bash
sudo systemctl stop orca-server.service
sudo cp -a /opt/orca/backups/orca-linux.AppImage.<UTC> /opt/orca/orca-linux.AppImage
sudo cp -a /opt/orca/backups/VERSION.<UTC> /opt/orca/VERSION
sudo systemctl restart orca-xvfb.service orca-server.service
```

Esto **no** revierte sqlite ni otro estado. Si la release migra bases, haz un
backup de `~/.config/orca` (u otra ruta de estado) **antes** de apply; este
script no lo hace.

## Relacion con el patron previo

El script persistente sustituye copias one-shot como
`/tmp/opencode/install-orca-v1.4.197-kukapu.1.sh`: mismos destinos
(`/opt/orca`, servicios xvfb/server, 6768), mas hash, cgroup fence, backups
de VERSION, stage en el mismo filesystem y health con deadline.
