# Prompt 061: Shell-Leiste – Login-`PATH` zuverlässig lesen

> **Slug:** `login-path-shell` · **Braucht:** 021 (Shell-Leiste, Design E6), 015 (Einstellungen) · **Umfang:** S
> Lies zuerst `prompts/000-arbeitsweise.md`, `prompts/done/021-shell-leiste.design.md` (Abschnitt **E6**),
> `src-tauri/src/shell/env.rs`, `src-tauri/src/commands/shell.rs` (`run_shell`, `load_shell_history`),
> `src-tauri/src/platform/process.rs` (`spawn_group`), `features/shell/shell.store.ts` (`apply`, Notice).
> Kein eigenes Design-Dokument nötig – Entscheidungen als Nachtrag „E6b“ in `021-shell-leiste.design.md` + Bericht.

## Auftrag (Marc, 01.11.2026)

„Kann man das fixen?“ – Ausgabe der Shell-Leiste auf Marcs Mac (App aus dem Finder bzw. Dock gestartet):

```
/Users/marckronberg/RustroverProjects/artcraft> git pull
The PATH of the login shell could not be read; programs are searched in the app’s PATH.
From https://github.com/storytold/artcraft
 * [new branch]            dependabot/npm_and_yarn/frontend/fast-uri-3.1.9 -> origin/dependabot/…
 * [new branch]            dependabot/npm_and_yarn/frontend/undici-6.29.1 -> origin/dependabot/…
Already up to date.
```

`git` lief nur, weil es unter `/usr/bin` liegt. Mit `brew`, `node`, `pnpm`, `cargo` … wäre der Befehl gescheitert
(`command not found`) – genau das sollte E6 verhindern. In 021 stand „macOS-`PATH` bei Marc offen“; jetzt ist klar:
**auf Marcs Mac schlägt das Lesen fehl.** Ziel: die Meldung verschwindet im Normalfall, und wenn es doch scheitert,
weiß man warum.

## Ist-Zustand (`shell/env.rs`)

- `read_login_env`: `<$SHELL> -l -c env` über `spawn_group` (stdin null, `setsid`, stdout/stderr Pipes), Leser-Thread
  liest stdout **bis EOF** (max. 1 MiB), Timeout `LOGIN_TIMEOUT = 3 s`. Erfolg nur, wenn der Exit-Status 0 ist **und**
  eine Zeile `PATH=` dabei ist.
- `login_env` cacht das Ergebnis **für die ganze Laufzeit der App – auch den Fehlschlag** (`Some(None)`). Ein einziges
  Scheitern (z. B. der erste, kalte Start der zsh nach dem Booten, Spotlight/FileVault beschäftigt) bleibt also bis
  zum Neustart der App.
- `run_shell` hängt bei `None` an **jeden** Befehl die Notice `loginEnvUnavailable` – das Design versprach eine
  „einmalige Info-Zeile“.
- Die Notice sagt nicht, *was* schiefging. Ohne Grund kann Marc es nicht melden und wir können es nicht prüfen.

## Verdächtige Ursachen (zuerst klären, nicht raten)

1. **Pipe bleibt offen:** Startet `.zprofile`/`.zlogin` einen Hintergrundprozess, der stdout erbt (ssh-agent,
   gpg-agent, `brew`-Autoupdate, nvm/pyenv-Hooks, JetBrains-Toolbox-Skripte, `colima`/`orbstack` …) und sich per
   eigenem `setsid`/Double-Fork aus der Gruppe löst, kommt nie EOF: `rx.recv_timeout` läuft ab → `None`, obwohl `env`
   längst alles geschrieben hat. **Stärkster Verdacht.**
2. **Timeout zu knapp:** zsh mit oh-my-zsh/`brew shellenv`/conda/nvm braucht beim kalten Start gern > 3 s.
3. **Exit-Status ≠ 0:** Profil endet mit fehlschlagendem Befehl und `setopt ERR_EXIT`/`set -e`, `env` läuft trotzdem
   oder gar nicht. Den Status nicht blind zum K.-o.-Kriterium machen, wenn eine vollständige Ausgabe vorliegt.
4. **Falsche Shell:** `$SHELL` fehlt oder ist kein `KNOWN_POSIX` → `/bin/sh`; liest `~/.profile`, nicht
   `~/.zprofile` → PATH ohne Homebrew (kein Fehlschlag, aber nutzlos). Prüfen, was `choose` bei Marc liefert.
5. **`.zshrc` wird nicht gelesen:** `zsh -l -c` ist nicht interaktiv – viele setzen `PATH` (nvm, `~/.cargo/env`,
   pnpm) in `.zshrc`. Auch das ist kein Fehlschlag, erklärt aber „node not found“ trotz gelesener Login-Umgebung.

## Aufgaben

1. **Diagnose zuerst** (roter Test vor jedem Fix, CLAUDE.md §6): `read_login_env` liefert statt `Option` ein
   `Result<Vec<…>, LoginEnvError>` mit Grund: `Timeout`, `NoEof` (Prozess beendet, Pipe offen), `ExitStatus(i32)`,
   `NoPath`, `Spawn(io::ErrorKind)`, `NotPosix`. Tests in `shell/tests.rs` mit Fake-„Shells“ als Skript:
   - Profil startet `sleep 30 &` mit geerbtem stdout → heute `None`, danach Erfolg in < 1 s (Ursache 1).
   - Shell, die erst nach 3,5 s antwortet (Ursache 2), Shell mit Rauschen vor/nach `env` (Banner, `echo` im Profil),
     Shell mit Exit 1 nach vollständigem `env` (Ursache 3).
2. **Robustes Lesen mit Markern** (wie VS Code `resolveShellEnv`): Befehl
   `-l -c 'printf "\n%s\n" <M>; env; printf "\n%s\n" <M>'` mit zufälligem Marker je Aufruf. Der Leser parst
   **inkrementell** und ist fertig, sobald der End-Marker gelesen wurde – dann Prozessgruppe beenden, auf offene Pipes
   nicht warten. Nur Zeilen zwischen den Markern werten (Profil-Ausgaben stören nicht mehr). Fish: eigene Syntax
   (`printf` geht, `-l -c` ebenso – im Test abdecken). `env -0` bleibt draußen (Review 021 #6).
3. **Timeout und Cache:** Timeout auf ~10 s (Lesen läuft ohnehin vorab beim Einblenden der Leiste über
   `load_shell_history`). Fehlschläge **nicht** für immer cachen: nach einem Fehlschlag beim nächsten Befehl erneut
   versuchen (höchstens alle 60 s, ein laufender Versuch wird nicht verdoppelt). Läuft der Vorab-Versuch noch, wartet
   `run_shell` bis zum Timeout darauf statt sofort ohne PATH zu starten – Abwägung im Bericht.
4. **`.zshrc` optional einbeziehen:** prüfen, ob `-i -l -c` (interaktiv, wie VS Code) bei zsh/bash ohne TTY sauber
   läuft (Warnungen „no job control“, `compinit`-Fragen, Prompt-Themes wie powerlevel10k mit Instant-Prompt). Wenn
   ja: Einstellung `shell.loginPath` wird ein Select `off` / `login` / `loginInteractive` (Default
   `loginInteractive` auf macOS, Migration des alten `true`/`false` in `settings.rs` + Schema + Import 026). Wenn
   nicht sicher machbar: nur dokumentieren (Hilfetext: „PATH in `~/.zprofile` setzen“).
5. **Rückfallebene ohne Login-Shell** (macOS): schlägt alles fehl, PATH der App ergänzen um
   `/usr/libexec/path_helper -s` (liest `/etc/paths`, `/etc/paths.d`) und vorhandene Standardorte
   `/opt/homebrew/bin`, `/opt/homebrew/sbin`, `/usr/local/bin`, `~/.cargo/bin` (nur wenn existent, keine Duplikate,
   Reihenfolge: Login-PATH > Rückfall > App-PATH). Reine Funktion `merge_path` mit Tests; Linux: `~/.local/bin`,
   `~/.cargo/bin`.
6. **Meldung:** Notice nur **einmal je App-Lauf** (bzw. erneut nach einem neuen Fehlschlag nach Erfolg), mit Grund:
   „The PATH of the login shell could not be read (timeout after 10 s); using the app’s PATH plus standard
   locations. Settings → Shell.“ – Notice als Code + Parameter (`loginEnvUnavailable:timeout`), Text aus dem Katalog
   (en/de, `catalogs.spec.ts`), kein Pfad, keine Umgebungswerte in Meldung oder Log (§4 Sicherheit). Im Log (Debug)
   nur Grund und Dauer.
7. **Diagnose-Hilfe für Marc:** Shell-Builtin oder Aktion „Shell: show login PATH status“ (nur Grund, Dauer, Shell-
   Programm, Anzahl PATH-Einträge – keine Werte), damit Marc ohne Debug-Build sagen kann, was passiert. Kleinste
   Lösung wählen; wenn zu groß, weglassen und begründen.
8. Doku: Design 021 Nachtrag „E6b“, `docs/feature-parity.md`/README nur falls betroffen, `TODO.md`: Abnahme auf dem Mac.

## Akzeptanzkriterien

1. Auf Marcs Mac (App aus dem Dock): `which brew node pnpm cargo` in der Shell-Leiste findet die Programme, die das
   Terminal findet (soweit in `.zprofile`/`.zshrc` gesetzt – je nach Ergebnis von Aufgabe 4); **keine** Info-Zeile.
2. Profil mit Hintergrundprozess, Rauschen oder Exit ≠ 0 nach `env` → Login-PATH wird trotzdem gelesen (Tests).
3. Hängt die Login-Shell wirklich: nach dem Timeout eine Info-Zeile mit Grund, **einmal**; Befehle laufen mit
   App-PATH + Rückfallorten; ein späterer Befehl versucht es erneut (nicht öfter als alle 60 s).
4. `shell.loginPath` aus → nie eine Login-Shell, keine Info-Zeile.
5. Keine Umgebungswerte/Pfade in Logs oder Events; `cargo test`, `pnpm check` grün.

## Tests

- Rust `shell/tests.rs`: Fake-Shells (Skripte in `tempdir`) für die Fälle aus Aufgabe 1; Marker-Parser rein
  (Rauschen, fehlender End-Marker, CRLF, sehr lange Zeilen bis zur 1-MiB-Grenze); `merge_path` (Duplikate,
  fehlende Ordner, Reihenfolge); Retry-Drossel mit injizierter Uhr (`platform/clock.rs`).
- `commands/shell.rs`-Tests: Notice einmal, Grund im Code.
- Frontend `shell.spec.ts`: Notice mit Grund (en/de), nur einmal je Lauf.
- E2E unter Xvfb: App mit `env -i HOME=… DISPLAY=… PATH=/usr/bin:/bin` starten (simuliert Finder-Start), Fake-`SHELL`
  mit Profil, das `sleep 30 &` startet und `PATH` erweitert → Programm aus dem erweiterten PATH läuft.
- Mac (Marc): Akzeptanzkriterium 1 – als offener Punkt in `TODO.md`, falls nicht in der Sitzung prüfbar.

## Nicht in diesem Prompt

- Ganze Login-Umgebung übernehmen (bleibt bei `PATH`/`MANPATH`/`LANG`/`LC_*`, E6).
- PTY/echte interaktive Programme in der Leiste (021: Pipes statt PTY).
- Windows (dort keine Login-Shell; `PATH` kommt aus der Registry, kein bekanntes Problem).
