/* Migración 005: presupuesto por periodos, categorías editables y apartados de ahorro.
     sqlcmd -S localhost -U sa -P "<password>" -i database/migrations/005_budget_savings.sql
   Es segura de correr más de una vez. */
USE multiApp;
GO

/* Configuración del presupuesto de cada usuario */
IF OBJECT_ID('dbo.BudgetSettings', 'U') IS NULL
BEGIN
CREATE TABLE dbo.BudgetSettings (
    UserId          INT           NOT NULL PRIMARY KEY,
    Period          NVARCHAR(10)  NOT NULL CONSTRAINT DF_BudgetSettings_Period DEFAULT 'monthly', -- monthly | biweekly | weekly
    StartDay        TINYINT       NOT NULL CONSTRAINT DF_BudgetSettings_StartDay DEFAULT 1,       -- mensual: día 1-28; semanal: 1=lunes … 7=domingo
    AlertsEnabled   BIT           NOT NULL CONSTRAINT DF_BudgetSettings_Alerts DEFAULT 1,
    RolloverFundId  INT           NULL,                                                         -- apartado sugerido para lo que sobre
    UpdatedAt       DATETIME2     NOT NULL CONSTRAINT DF_BudgetSettings_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_BudgetSettings_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE,
    CONSTRAINT CK_BudgetSettings_Period CHECK (Period IN ('monthly', 'biweekly', 'weekly'))
);
END;
GO

/* Categorías (las mismas para Gastos y Presupuesto). Expenses.Category guarda el nombre. */
IF OBJECT_ID('dbo.BudgetCategories', 'U') IS NULL
BEGIN
CREATE TABLE dbo.BudgetCategories (
    Id         INT IDENTITY(1,1) PRIMARY KEY,
    UserId     INT           NOT NULL,
    Name       NVARCHAR(50)  NOT NULL,
    Icon       NVARCHAR(40)  NOT NULL CONSTRAINT DF_BudgetCategories_Icon DEFAULT 'other',
    Color      NVARCHAR(20)  NOT NULL CONSTRAINT DF_BudgetCategories_Color DEFAULT 'ink',
    SortOrder  INT           NOT NULL CONSTRAINT DF_BudgetCategories_Sort DEFAULT 0,
    CreatedAt  DATETIME2     NOT NULL CONSTRAINT DF_BudgetCategories_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt  DATETIME2     NOT NULL CONSTRAINT DF_BudgetCategories_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_BudgetCategories_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE,
    CONSTRAINT UQ_BudgetCategories_Name UNIQUE (UserId, Name)
);
END;
GO

/* Periodos de presupuesto (fechas locales del usuario) */
IF OBJECT_ID('dbo.BudgetPeriods', 'U') IS NULL
BEGIN
CREATE TABLE dbo.BudgetPeriods (
    Id         INT IDENTITY(1,1) PRIMARY KEY,
    UserId     INT            NOT NULL,
    StartDate  DATE           NOT NULL,
    EndDate    DATE           NOT NULL,
    Period     NVARCHAR(10)   NOT NULL,
    Income     DECIMAL(12, 2) NULL,
    ClosedAt   DATETIME2      NULL,
    CreatedAt  DATETIME2      NOT NULL CONSTRAINT DF_BudgetPeriods_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt  DATETIME2      NOT NULL CONSTRAINT DF_BudgetPeriods_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_BudgetPeriods_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE,
    CONSTRAINT UQ_BudgetPeriods_Start UNIQUE (UserId, StartDate),
    CONSTRAINT CK_BudgetPeriods_Dates CHECK (EndDate >= StartDate),
    CONSTRAINT CK_BudgetPeriods_Income CHECK (Income IS NULL OR Income >= 0)
);
END;
GO

/* Límite de cada categoría en un periodo (CategoryId sin FK para evitar rutas de borrado en cascada múltiples) */
IF OBJECT_ID('dbo.BudgetLimits', 'U') IS NULL
BEGIN
CREATE TABLE dbo.BudgetLimits (
    PeriodId    INT            NOT NULL,
    CategoryId  INT            NOT NULL,
    Amount      DECIMAL(12, 2) NOT NULL,
    CONSTRAINT PK_BudgetLimits PRIMARY KEY (PeriodId, CategoryId),
    CONSTRAINT FK_BudgetLimits_Periods FOREIGN KEY (PeriodId) REFERENCES dbo.BudgetPeriods(Id) ON DELETE CASCADE,
    CONSTRAINT CK_BudgetLimits_Amount CHECK (Amount >= 0)
);
END;
GO

/* Apartados: Ahorro, Emergencias, Medicamentos… (el dinero puede estar en cualquier lado) */
IF OBJECT_ID('dbo.SavingsFunds', 'U') IS NULL
BEGIN
CREATE TABLE dbo.SavingsFunds (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    UserId      INT            NOT NULL,
    Name        NVARCHAR(60)   NOT NULL,
    Icon        NVARCHAR(40)   NOT NULL CONSTRAINT DF_SavingsFunds_Icon DEFAULT 'savings',
    Color       NVARCHAR(20)   NOT NULL CONSTRAINT DF_SavingsFunds_Color DEFAULT 'green',
    Goal        DECIMAL(12, 2) NULL,
    GoalDate    DATE           NULL,
    AutoType    NVARCHAR(10)   NOT NULL CONSTRAINT DF_SavingsFunds_AutoType DEFAULT 'none', -- none | fixed | percent
    AutoValue   DECIMAL(12, 2) NULL,
    IsArchived  BIT            NOT NULL CONSTRAINT DF_SavingsFunds_Archived DEFAULT 0,
    SortOrder   INT            NOT NULL CONSTRAINT DF_SavingsFunds_Sort DEFAULT 0,
    CreatedAt   DATETIME2      NOT NULL CONSTRAINT DF_SavingsFunds_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt   DATETIME2      NOT NULL CONSTRAINT DF_SavingsFunds_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_SavingsFunds_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE,
    CONSTRAINT CK_SavingsFunds_AutoType CHECK (AutoType IN ('none', 'fixed', 'percent')),
    CONSTRAINT CK_SavingsFunds_Goal CHECK (Goal IS NULL OR Goal > 0)
);
CREATE INDEX IX_SavingsFunds_User ON dbo.SavingsFunds (UserId);
END;
GO

/* Depósitos (+) y retiros (−) de cada apartado */
IF OBJECT_ID('dbo.FundMovements', 'U') IS NULL
BEGIN
CREATE TABLE dbo.FundMovements (
    Id         INT IDENTITY(1,1) PRIMARY KEY,
    FundId     INT            NOT NULL,
    UserId     INT            NOT NULL,
    Amount     DECIMAL(12, 2) NOT NULL,
    Note       NVARCHAR(200)  NULL,
    Source     NVARCHAR(10)   NOT NULL CONSTRAINT DF_FundMovements_Source DEFAULT 'manual', -- manual | auto | rollover
    PeriodId   INT            NULL,
    MovedAt    DATETIME2      NOT NULL CONSTRAINT DF_FundMovements_MovedAt DEFAULT SYSUTCDATETIME(),
    CreatedAt  DATETIME2      NOT NULL CONSTRAINT DF_FundMovements_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_FundMovements_Funds FOREIGN KEY (FundId) REFERENCES dbo.SavingsFunds(Id) ON DELETE CASCADE,
    CONSTRAINT CK_FundMovements_Amount CHECK (Amount <> 0),
    CONSTRAINT CK_FundMovements_Source CHECK (Source IN ('manual', 'auto', 'rollover'))
);
CREATE INDEX IX_FundMovements_Fund ON dbo.FundMovements (FundId, MovedAt);
CREATE INDEX IX_FundMovements_UserPeriod ON dbo.FundMovements (UserId, PeriodId);
END;
GO
