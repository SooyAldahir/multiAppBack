/* Migración 002: agrega la tabla de Lugares guardados.
   Ejecútala si ya habías creado la base con una versión anterior de schema.sql:
     sqlcmd -S localhost -U sa -P "<password>" -i database/migrations/002_places.sql
   Es segura de correr más de una vez. */
USE multiApp;
GO

/* ---------- Lugares guardados (casa, trabajo, iglesia...) ---------- */
IF OBJECT_ID('dbo.Places', 'U') IS NULL
BEGIN
CREATE TABLE dbo.Places (
    Id         INT IDENTITY(1,1) PRIMARY KEY,
    UserId     INT            NOT NULL,
    Name       NVARCHAR(100)  NOT NULL,
    Category   NVARCHAR(20)   NOT NULL CONSTRAINT DF_Places_Category DEFAULT 'other',
    Address    NVARCHAR(300)  NULL,
    Latitude   DECIMAL(9, 6)  NOT NULL,
    Longitude  DECIMAL(9, 6)  NOT NULL,
    Notes      NVARCHAR(500)  NULL,
    CreatedAt  DATETIME2      NOT NULL CONSTRAINT DF_Places_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt  DATETIME2      NOT NULL CONSTRAINT DF_Places_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Places_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE,
    CONSTRAINT CK_Places_Category CHECK (Category IN ('home', 'work', 'church', 'school', 'gym', 'family', 'store', 'other')),
    CONSTRAINT CK_Places_Coords CHECK (Latitude BETWEEN -90 AND 90 AND Longitude BETWEEN -180 AND 180)
);
CREATE INDEX IX_Places_User ON dbo.Places (UserId);
END;
GO
