USE [XUNGStore];
GO

IF COL_LENGTH(N'dbo.Users', N'Role') IS NULL
    ALTER TABLE dbo.Users ADD Role NVARCHAR(20) NULL;
GO

UPDATE dbo.Users SET Role = N'customer' WHERE Role IS NULL;
GO

ALTER TABLE dbo.Users ALTER COLUMN Role NVARCHAR(20) NOT NULL;
GO

IF OBJECT_ID(N'dbo.DF_Users_Role', N'D') IS NULL
    ALTER TABLE dbo.Users ADD CONSTRAINT DF_Users_Role DEFAULT (N'customer') FOR Role;
GO

IF OBJECT_ID(N'dbo.CK_Users_Role', N'C') IS NULL
    ALTER TABLE dbo.Users ADD CONSTRAINT CK_Users_Role
        CHECK (Role IN (N'customer', N'admin'));
GO
