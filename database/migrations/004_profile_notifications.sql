/* Migración 004: perfil completo (foto, teléfono, ciudad...), preferencias de notificaciones
   y tokens de dispositivos para notificaciones push.
     sqlcmd -S localhost -U sa -P "<password>" -i database/migrations/004_profile_notifications.sql
   Es segura de correr más de una vez. */
USE multiApp;
GO

/* ---------- Perfil completo y notificaciones ---------- */
IF COL_LENGTH('dbo.Users', 'AvatarUrl') IS NULL ALTER TABLE dbo.Users ADD AvatarUrl NVARCHAR(500) NULL;
IF COL_LENGTH('dbo.Users', 'Phone') IS NULL ALTER TABLE dbo.Users ADD Phone NVARCHAR(30) NULL;
IF COL_LENGTH('dbo.Users', 'BirthDate') IS NULL ALTER TABLE dbo.Users ADD BirthDate DATE NULL;
IF COL_LENGTH('dbo.Users', 'City') IS NULL ALTER TABLE dbo.Users ADD City NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.Users', 'Bio') IS NULL ALTER TABLE dbo.Users ADD Bio NVARCHAR(300) NULL;
IF COL_LENGTH('dbo.Users', 'NotificationPrefs') IS NULL ALTER TABLE dbo.Users ADD NotificationPrefs NVARCHAR(MAX) NULL;
GO

/* Tokens de Firebase Cloud Messaging de cada teléfono (para notificaciones push) */
IF OBJECT_ID('dbo.DeviceTokens', 'U') IS NULL
BEGIN
CREATE TABLE dbo.DeviceTokens (
    Id         INT IDENTITY(1,1) PRIMARY KEY,
    UserId     INT            NOT NULL,
    Token      NVARCHAR(400)  NOT NULL,
    Platform   NVARCHAR(10)   NOT NULL CONSTRAINT DF_Device_Platform DEFAULT 'android',
    CreatedAt  DATETIME2      NOT NULL CONSTRAINT DF_Device_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt  DATETIME2      NOT NULL CONSTRAINT DF_Device_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Device_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE,
    CONSTRAINT UQ_Device_Token UNIQUE (Token)
);
CREATE INDEX IX_Device_User ON dbo.DeviceTokens (UserId);
END;
GO
