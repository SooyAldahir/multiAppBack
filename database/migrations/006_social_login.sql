/* 006: iniciar sesión con Google / Apple.
   - Las cuentas creadas con Google o Apple no tienen contraseña (PasswordHash NULL).
   - UserIdentities guarda qué cuenta de Google/Apple pertenece a cada usuario.
   Se puede correr varias veces. También funciona pegado tal cual en el editor de consultas de Azure. */

IF EXISTS (SELECT 1 FROM sys.columns
           WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'PasswordHash' AND is_nullable = 0)
    ALTER TABLE dbo.Users ALTER COLUMN PasswordHash NVARCHAR(255) NULL;

IF OBJECT_ID('dbo.UserIdentities', 'U') IS NULL
CREATE TABLE dbo.UserIdentities (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    UserId        INT            NOT NULL,
    Provider      NVARCHAR(20)   NOT NULL,
    Subject       NVARCHAR(255)  NOT NULL,
    Email         NVARCHAR(255)  NULL,
    RefreshToken  NVARCHAR(1000) NULL,   -- solo Apple: para revocar al eliminar la cuenta
    CreatedAt     DATETIME2      NOT NULL CONSTRAINT DF_UserIdentities_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_UserIdentities_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE,
    CONSTRAINT UQ_UserIdentities_Provider_Subject UNIQUE (Provider, Subject),
    CONSTRAINT CK_UserIdentities_Provider CHECK (Provider IN ('google', 'apple'))
);
