Test certificates for the in-process FTPS server of the Rust tests (design 034).
`ca.pem` is a private test CA (its key was thrown away), `server.pem`/`server.key` a leaf
for `localhost`/`127.0.0.1`, valid for 100 years. Never used outside `#[cfg(test)]`.
`id_ed25519_pass` (+ `.pub`) is a test client key, encrypted with the passphrase `geheim`.
