-- Absen di luar area lokasi kerja: wajib keterangan, dan baru diakui hadir setelah
-- disetujui Project Manager atau Site Manager (approval_status = APPROVED).
-- Absen di dalam area langsung APPROVED (tidak perlu persetujuan).
ALTER TABLE attendance ADD (check_in_outside NUMBER(1) DEFAULT 0 NOT NULL);
ALTER TABLE attendance ADD (check_in_reason VARCHAR2(500));
ALTER TABLE attendance ADD (check_out_outside NUMBER(1) DEFAULT 0 NOT NULL);
ALTER TABLE attendance ADD (check_out_reason VARCHAR2(500));
ALTER TABLE attendance ADD (approval_status VARCHAR2(10) DEFAULT 'APPROVED' NOT NULL);
ALTER TABLE attendance ADD (approved_by NUMBER);
ALTER TABLE attendance ADD (approved_at TIMESTAMP WITH TIME ZONE);
ALTER TABLE attendance ADD (approval_note VARCHAR2(500));
ALTER TABLE attendance ADD CONSTRAINT ck_att_approval CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED'));
ALTER TABLE attendance ADD CONSTRAINT fk_att_approver FOREIGN KEY (approved_by) REFERENCES users(id);
CREATE INDEX ix_att_approval ON attendance(approval_status, site_id);
