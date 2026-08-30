/** 飞书多维表格插件 - 时间追踪
 *
 * 这是插件的 React 入口。对应原 Vue 前端的 TimerView。
 *
 * 数据访问方式：
 * - 不再调 Python/Node.js 后端
 * - 直接用 @lark-opdev/block-bitable-api 读写当前多维表格
 * - 表结构：time_entries（时间条目）、projects（项目）、clients（客户）、tags（标签）
 */
import React, { useState, useEffect } from 'react';
import { bitable } from '@lark-opdev/block-bitable-api';

const TIME_ENTRIES_TABLE = 'tbl4DQrLz56St8Uj'; // 时间条目表
const PROJECTS_TABLE = 'tblqDz3NolO5yXkA';    // 项目表

const FIELD_DESCRIPTION = '描述';
const FIELD_START = '开始时间';
const FIELD_STOP = '结束时间';
const FIELD_DURATION = '时长(秒)';
const FIELD_USER = '用户';
const FIELD_STATE = '状态';
const FIELD_BILLABLE = '是否计费';
const FIELD_PROJECT = '项目';

const STATE_RUNNING = 'running';
const STATE_STOPPED = 'stopped';

// ──────────────────────────────────────────────
//  计时器组件
// ──────────────────────────────────────────────

function TimerView() {
  const [currentEntry, setCurrentEntry] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showStartDialog, setShowStartDialog] = useState(false);
  const [description, setDescription] = useState('');
  const [userName, setUserName] = useState(localStorage.getItem('tt_user') || '');

  // 实时计时
  useEffect(() => {
    if (!currentEntry) {
      setElapsed(0);
      return;
    }
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - currentEntry.startMs) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [currentEntry]);

  // 启动时加载当前计时器
  useEffect(() => {
    loadCurrentEntry();
  }, []);

  async function loadCurrentEntry() {
    try {
      const table = await bitable.base.getTableById(TIME_ENTRIES_TABLE);
      const records = await table.getRecords({
        filter: { conjunction: 'and', conditions: [
          { field_name: FIELD_STATE, operator: 'is', value: [STATE_RUNNING] }
        ]}
      });
      // MVP: 取第一个 running
      if (records.records && records.records.length > 0) {
        const r = records.records[0];
        const startMs = r.fields[FIELD_START] || Date.now();
        setCurrentEntry({ recordId: r.record_id, description: r.fields[FIELD_DESCRIPTION] || '', startMs });
      }
    } catch (e) {
      console.error('loadCurrentEntry failed:', e);
    }
  }

  async function startTimer() {
    if (!userName) {
      setError('请填写用户名');
      return;
    }
    setError('');
    try {
      const table = await bitable.base.getTableById(TIME_ENTRIES_TABLE);
      const startMs = Date.now();
      const result = await table.addRecord({
        fields: {
          [FIELD_DESCRIPTION]: description,
          [FIELD_START]: startMs,
          [FIELD_STATE]: STATE_RUNNING,
          [FIELD_USER]: userName,
          [FIELD_BILLABLE]: false,
          [FIELD_DURATION]: 0,
        }
      });
      setCurrentEntry({ recordId: result.record_id, description, startMs });
      setShowStartDialog(false);
      setDescription('');
      setSuccess('计时已开始');
      setTimeout(() => setSuccess(''), 2000);
      localStorage.setItem('tt_user', userName);
    } catch (e) {
      setError(e.message);
    }
  }

  async function stopTimer() {
    if (!currentEntry) return;
    setError('');
    try {
      const table = await bitable.base.getTableById(TIME_ENTRIES_TABLE);
      const stopMs = Date.now();
      const durationSec = Math.floor((stopMs - currentEntry.startMs) / 1000);
      await table.updateRecord(currentEntry.recordId, {
        fields: {
          [FIELD_STOP]: stopMs,
          [FIELD_DURATION]: durationSec,
          [FIELD_STATE]: STATE_STOPPED,
        }
      });
      setCurrentEntry(null);
      setSuccess('计时已停止');
      setTimeout(() => setSuccess(''), 2000);
    } catch (e) {
      setError(e.message);
    }
  }

  const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
  const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 20 }}>
      <section style={{
        background: currentEntry ? '#fef3c7' : '#fff',
        borderRadius: 12, padding: 40, textAlign: 'center',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 20
      }}>
        <div style={{ fontSize: 56, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#1f2937', marginBottom: 12 }}>
          {h}:{m}:{s}
        </div>
        <div style={{ minHeight: 24, marginBottom: 24 }}>
          {currentEntry ? (
            <span style={{ fontSize: 16, color: '#374151' }}>{currentEntry.description}</span>
          ) : (
            <span style={{ fontSize: 16, color: '#9ca3af' }}>未开始计时</span>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
          {!currentEntry ? (
            <button onClick={() => setShowStartDialog(true)} style={btnPrimary}>▶ 开始计时</button>
          ) : (
            <button onClick={stopTimer} style={{...btnPrimary, background: '#ef4444'}}>■ 停止</button>
          )}
        </div>
      </section>

      {error && <div style={alertError}>{error}</div>}
      {success && <div style={alertSuccess}>{success}</div>}

      {showStartDialog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 400, maxWidth: '90vw' }}>
            <h3 style={{ marginTop: 0 }}>开始计时</h3>
            <label style={{ display: 'block', marginBottom: 12, fontSize: 13, color: '#6b7280' }}>
              用户
              <input value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="你的名字" style={inputStyle} />
            </label>
            <label style={{ display: 'block', marginBottom: 12, fontSize: 13, color: '#6b7280' }}>
              描述
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="你在做什么？" style={inputStyle} />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setShowStartDialog(false)} style={{...btnPrimary, background: '#f3f4f6', color: '#374151'}}>取消</button>
              <button onClick={startTimer} disabled={!userName} style={btnPrimary}>开始</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const btnPrimary = {
  fontSize: 16, padding: '12px 32px', background: '#10b981', color: '#fff',
  border: 'none', borderRadius: 6, cursor: 'pointer'
};
const inputStyle = {
  display: 'block', width: '100%', padding: '8px 12px', marginTop: 4,
  border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14
};
const alertError = { padding: '12px 16px', borderRadius: 8, marginTop: 16, fontSize: 14, background: '#fee2e2', color: '#991b1b' };
const alertSuccess = { padding: '12px 16px', borderRadius: 8, marginTop: 16, fontSize: 14, background: '#d1fae5', color: '#065f46' };

export default TimerView;
