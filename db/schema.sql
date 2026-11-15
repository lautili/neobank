CREATE DATABASE IF NOT EXISTS neobank
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE neobank;

CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  apellido VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  dni VARCHAR(16) NOT NULL,
  alias VARCHAR(30) NULL,
  alias_updated_at DATETIME NULL,
  avatar_url VARCHAR(2048) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_usuarios_email (email),
  UNIQUE KEY uq_usuarios_dni (dni)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cuentas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  cbu CHAR(22) NOT NULL,
  cvu CHAR(22) NOT NULL,
  saldo DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  moneda CHAR(3) NOT NULL DEFAULT 'ARS',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cuentas_cbu (cbu),
  UNIQUE KEY uq_cuentas_cvu (cvu),
  KEY idx_cuentas_usuario (usuario_id),
  CONSTRAINT fk_cuentas_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
  CONSTRAINT chk_cuentas_saldo CHECK (saldo >= 0),
  CONSTRAINT chk_cuentas_moneda CHECK (moneda = 'ARS')
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tarjetas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cuenta_id INT NOT NULL,
  numero_enmascarado VARCHAR(19) NOT NULL,
  tipo ENUM('debito', 'credito') NOT NULL,
  estado ENUM('activa', 'bloqueada') NOT NULL DEFAULT 'activa',
  limite_credito DECIMAL(12,2) NULL,
  KEY idx_tarjetas_cuenta (cuenta_id),
  CONSTRAINT fk_tarjetas_cuenta
    FOREIGN KEY (cuenta_id) REFERENCES cuentas (id),
  CONSTRAINT chk_tarjetas_limite CHECK (
    (tipo = 'debito' AND limite_credito IS NULL)
    OR (tipo = 'credito' AND limite_credito IS NOT NULL AND limite_credito >= 0)
  )
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transferencias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cuenta_origen_id INT NOT NULL,
  cuenta_destino_id INT NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  descripcion TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_transferencias_origen (cuenta_origen_id),
  KEY idx_transferencias_destino (cuenta_destino_id),
  CONSTRAINT fk_transferencias_origen
    FOREIGN KEY (cuenta_origen_id) REFERENCES cuentas (id),
  CONSTRAINT fk_transferencias_destino
    FOREIGN KEY (cuenta_destino_id) REFERENCES cuentas (id),
  CONSTRAINT chk_transferencias_monto CHECK (monto > 0),
  CONSTRAINT chk_transferencias_cuentas CHECK (cuenta_origen_id <> cuenta_destino_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS movimientos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cuenta_id INT NOT NULL,
  tipo ENUM(
    'ingreso',
    'extraccion',
    'transferencia_enviada',
    'transferencia_recibida',
    'prestamo',
    'plazo_fijo',
    'plazo_fijo_cancelado',
    'plazo_fijo_vencido'
  ) NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  saldo_resultante DECIMAL(12,2) NOT NULL,
  referencia_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_movimientos_cuenta_fecha (cuenta_id, created_at),
  CONSTRAINT fk_movimientos_cuenta
    FOREIGN KEY (cuenta_id) REFERENCES cuentas (id),
  CONSTRAINT chk_movimientos_monto CHECK (monto > 0),
  CONSTRAINT chk_movimientos_saldo CHECK (saldo_resultante >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS prestamos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  monto_solicitado DECIMAL(12,2) NOT NULL,
  cuotas INT NOT NULL,
  tasa_interes DECIMAL(5,2) NOT NULL,
  estado ENUM('pendiente', 'activo', 'pagado') NOT NULL DEFAULT 'pendiente',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_prestamos_usuario (usuario_id),
  CONSTRAINT fk_prestamos_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
  CONSTRAINT chk_prestamos_monto CHECK (monto_solicitado > 0),
  CONSTRAINT chk_prestamos_cuotas CHECK (cuotas BETWEEN 1 AND 60),
  CONSTRAINT chk_prestamos_tasa CHECK (tasa_interes >= 0 AND tasa_interes <= 200)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS plazos_fijos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cuenta_id INT NOT NULL,
  monto_invertido DECIMAL(12,2) NOT NULL,
  tasa_nominal_anual DECIMAL(5,2) NOT NULL,
  dias INT NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_vencimiento DATE NOT NULL,
  liquidado_at DATETIME NULL,
  estado ENUM('activo', 'finalizado', 'cancelado') NOT NULL DEFAULT 'activo',
  KEY idx_plazos_cuenta (cuenta_id),
  CONSTRAINT fk_plazos_cuenta
    FOREIGN KEY (cuenta_id) REFERENCES cuentas (id),
  CONSTRAINT chk_plazos_monto CHECK (monto_invertido > 0),
  CONSTRAINT chk_plazos_tasa CHECK (tasa_nominal_anual >= 0 AND tasa_nominal_anual <= 200),
  CONSTRAINT chk_plazos_dias CHECK (dias BETWEEN 1 AND 365),
  CONSTRAINT chk_plazos_fechas CHECK (fecha_vencimiento > fecha_inicio)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS idempotency_requests (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  operacion VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  response_body JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_idempotency_user_operation_key (usuario_id, operacion, key_hash),
  CONSTRAINT fk_idempotency_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
) ENGINE=InnoDB;
