import { useState, useRef, useEffect } from 'react';
import './App.css';
import { db, storage } from './firebase';
import { collection, addDoc, serverTimestamp, doc, getDocs, query, where, onSnapshot } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

function App() {
  // 관리자 페이지 상태
  const [isAdminPage, setIsAdminPage] = useState(false);
  const [adminPwInput, setAdminPwInput] = useState("");
  const [isAdminAuthed, setIsAdminAuthed] = useState(false);
  const ADMIN_PASSWORD = "admin1234"; // 실제 서비스 시 환경변수/서버로 대체 필요
  // 학생 관리 상태
  const [studentInput, setStudentInput] = useState("");
  const [students, setStudents] = useState<{ id: string; name: string }[]>([]);
  // 학생 목록 Firestore에서 실시간 불러오기
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'students'), (snap) => {
      setStudents(snap.docs.map(doc => ({ id: doc.id, name: doc.data().name })));
    });
    return unsub;
  }, []);
  const [name, setName] = useState("");
  const [entered, setEntered] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement>(null);

  // 녹음 관련 상태
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [recordings, setRecordings] = useState<{ url: string; date: string }[]>([]);
  const chunks = useRef<Blob[]>([]);

  // --- AB 반복 상태 ---
  const [repeatA, setRepeatA] = useState<number | null>(null);
  const [repeatB, setRepeatB] = useState<number | null>(null);
  const [isRepeating, setIsRepeating] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  // --- 구간 북마크 상태 ---
  type Bookmark = {
    start: number;
    end: number;
    date: string;
    memo: string;
  };
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [memoInput, setMemoInput] = useState("");
  const maxBookmarks = 10;

  // 학생별 파일 Firestore에서 실시간 불러오기
  const [studentsFiles, setStudentsFiles] = useState<{ [studentId: string]: { id: string; fileName: string; url: string }[] }>({});
  useEffect(() => {
    const unsubs: (() => void)[] = [];
    students.forEach(student => {
      const unsub = onSnapshot(collection(db, `students/${student.id}/files`), (snap) => {
        setStudentsFiles(prev => ({
          ...prev,
          [student.id]: snap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }))
        }));
      });
      unsubs.push(unsub);
    });
    return () => { unsubs.forEach(fn => fn()); };
  }, [students]);

  // 학생 로그인 후 본인 Firestore ID 상태
  const [studentId, setStudentId] = useState<string | null>(null);
  const [myFiles, setMyFiles] = useState<{ id: string; fileName: string; url: string }[]>([]);
  // 학생 로그인 시 Firestore에서 본인 ID 찾기 및 파일 목록 구독
  useEffect(() => {
    if (!entered || !name.trim()) return;
    let unsub: (() => void) | null = null;
    (async () => {
      const q = query(collection(db, 'students'), where('name', '==', name.trim()));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const docId = snap.docs[0].id;
        setStudentId(docId);
        unsub = onSnapshot(collection(db, `students/${docId}/files`), (fsnap) => {
          setMyFiles(fsnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any })));
        });
      } else {
        setStudentId(null);
        setMyFiles([]);
      }
    })();
    return () => { if (unsub) unsub(); };
  }, [entered, name]);

  // 학생 녹음 결과 업로드 및 목록
  const [myRecordings, setMyRecordings] = useState<{ id: string; url: string; fileName: string }[]>([]);
  // 학생 로그인 시 녹음 결과 목록 구독
  useEffect(() => {
    if (!studentId) return;
    const unsub = onSnapshot(collection(db, `students/${studentId}/results`), (snap) => {
      setMyRecordings(snap.docs.map(doc => ({ id: doc.id, ...doc.data() as any })));
    });
    return unsub;
  }, [studentId]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // 오디오 시간 업데이트 핸들러
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      if (
        isRepeating &&
        repeatA !== null &&
        repeatB !== null &&
        audio.currentTime >= repeatB
      ) {
        audio.currentTime = repeatA;
        audio.play();
      }
    };
    audio.addEventListener('timeupdate', onTimeUpdate);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
    };
  }, [isRepeating, repeatA, repeatB]);

  // A/B 지점 지정 함수
  const setPointA = () => {
    if (audioRef.current) setRepeatA(audioRef.current.currentTime);
  };
  const setPointB = () => {
    if (audioRef.current) setRepeatB(audioRef.current.currentTime);
  };
  const clearRepeat = () => {
    setRepeatA(null);
    setRepeatB(null);
    setIsRepeating(false);
  };

  // 북마크 저장
  const saveBookmark = () => {
    if (
      repeatA !== null &&
      repeatB !== null &&
      repeatA < repeatB &&
      bookmarks.length < maxBookmarks
    ) {
      const newBookmark: Bookmark = {
        start: repeatA,
        end: repeatB,
        date: new Date().toLocaleString(),
        memo: memoInput.trim(),
      };
      setBookmarks([newBookmark, ...bookmarks]);
      setMemoInput("");
    }
  };
  // 북마크 삭제
  const deleteBookmark = (idx: number) => {
    setBookmarks(bookmarks.filter((_, i) => i !== idx));
  };
  // 북마크 적용
  const applyBookmark = (bm: Bookmark) => {
    setRepeatA(bm.start);
    setRepeatB(bm.end);
    setIsRepeating(true);
    if (audioRef.current) {
      audioRef.current.currentTime = bm.start;
      audioRef.current.play();
    }
  };

  // 시간 포맷 함수
  const formatTime = (t: number | null) =>
    t === null ? '--:--' : `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  // 날짜 포맷 함수
  function formatUploadedAt(uploadedAt: any) {
    if (!uploadedAt) return '';
    try {
      return uploadedAt.toDate().toLocaleString();
    } catch {
      return '';
    }
  }

  const handleRateChange = (rate: number) => {
    setPlaybackRate(rate);
  };

  // 녹음 시작
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new window.MediaRecorder(stream);
      setMediaRecorder(recorder);
      chunks.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setRecordings((prev) => [
          { url, date: new Date().toLocaleString() },
          ...prev,
        ]);
      };
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      alert('마이크 권한이 필요합니다.');
    }
  };

  // 녹음 정지 (녹음 결과 업로드 추가)
  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      setIsRecording(false);
      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setRecordings((prev) => [
          { url, date: new Date().toLocaleString() },
          ...prev,
        ]);
        // 학생 로그인 상태면 업로드
        if (studentId) {
          await uploadRecording(blob);
        }
      };
    }
  };

  // 녹음 삭제
  const deleteRecording = (url: string) => {
    setRecordings((prev) => prev.filter((rec) => rec.url !== url));
    URL.revokeObjectURL(url);
  };
  // 녹음 다운로드
  const downloadRecording = (url: string, date: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `recording-${date.replace(/[^0-9]/g, '')}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Firestore에 학생 등록
  const addStudent = async () => {
    const name = studentInput.trim();
    if (!name) return;
    // 중복 체크 (Firestore에서)
    const q = query(collection(db, 'students'), where('name', '==', name));
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      alert('이미 등록된 학생입니다.');
      return;
    }
    await addDoc(collection(db, 'students'), {
      name,
      createdAt: serverTimestamp(),
    });
    setStudentInput("");
  };
  // Firestore에서 학생 삭제
  const deleteStudent = async (id: string) => {
    // 학생 문서 및 하위 파일 문서 삭제(간단 버전)
    await addDoc(collection(db, 'deleted_students'), { ...students.find(s => s.id === id), deletedAt: serverTimestamp() });
    await window.confirm('학생을 삭제하면 할당된 파일 정보도 모두 사라집니다. 계속하시겠습니까?') && (await import('firebase/firestore').then(fb => fb.deleteDoc(doc(db, 'students', id))));
  };

  // 파일 업로드 핸들러 (Storage + Firestore)
  const handleFileUpload = async (studentId: string, files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      // Storage에 업로드
      const sRef = storageRef(storage, `studentFiles/${studentId}/${f.name}`);
      await uploadBytes(sRef, f);
      const url = await getDownloadURL(sRef);
      // Firestore에 파일 정보 저장
      await addDoc(collection(db, `students/${studentId}/files`), {
        fileName: f.name,
        url,
        uploadedAt: serverTimestamp(),
      });
    }
    alert('파일 업로드 및 저장 완료!');
  };
  // 파일 삭제
  const deleteStudentFile = async (studentId: string, fileId: string) => {
    await import('firebase/firestore').then(fb => fb.deleteDoc(doc(db, `students/${studentId}/files`, fileId)));
  };
  // 파일 다운로드
  const downloadStudentFile = (file: { url: string; fileName: string }) => {
    const a = document.createElement('a');
    a.href = file.url;
    a.download = file.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // 녹음 결과 Storage/Firestore 업로드
  const uploadRecording = async (blob: Blob) => {
    if (!studentId) return;
    const fileName = `recording-${Date.now()}.webm`;
    const sRef = storageRef(storage, `studentResults/${studentId}/${fileName}`);
    await uploadBytes(sRef, blob);
    const url = await getDownloadURL(sRef);
    await addDoc(collection(db, `students/${studentId}/results`), {
      fileName,
      url,
      uploadedAt: serverTimestamp(),
    });
    alert('녹음 결과가 저장되었습니다!');
  };

  return (
    <div className="app-bg">
      {/* 헤더 */}
      <header className="app-header">
        <div className="header-left">
          <span className="header-icon">🎧</span>
          <div>
            <div className="header-title">제이스칸교육</div>
            <div className="header-desc">오디오 학습 시스템</div>
          </div>
        </div>
        <button className="admin-btn" onClick={() => setIsAdminPage(true)}>
          <span style={{ fontSize: 18 }}>⚙️</span> 관리자
        </button>
      </header>

      {/* 관리자 페이지 */}
      {isAdminPage ? (
        <div className="center-area">
          <div className="login-card">
            {!isAdminAuthed ? (
              <>
                <div className="card-title">관리자 로그인</div>
                <div className="card-desc">비밀번호를 입력하세요</div>
                <input
                  type="password"
                  value={adminPwInput}
                  onChange={e => setAdminPwInput(e.target.value)}
                  placeholder="비밀번호"
                  className="name-input"
                  style={{ marginBottom: 16 }}
                />
                <button
                  className="start-btn"
                  onClick={() => {
                    if (adminPwInput === ADMIN_PASSWORD) {
                      setIsAdminAuthed(true);
                    } else {
                      alert('비밀번호가 올바르지 않습니다.');
                    }
                  }}
                  disabled={!adminPwInput.trim()}
                >
                  로그인
                </button>
                <button
                  className="start-btn"
                  style={{ background: '#eee', color: '#888', marginTop: 10 }}
                  onClick={() => {
                    setIsAdminPage(false);
                    setAdminPwInput("");
                  }}
                >
                  돌아가기
                </button>
              </>
            ) : (
              <>
                <div className="card-title">학생 관리</div>
                {/* 학생 등록 UI */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
                  <input
                    type="text"
                    value={studentInput}
                    onChange={e => setStudentInput(e.target.value.slice(0, 30))}
                    placeholder="학생 이름 (최대 30자)"
                    className="name-input"
                    style={{ width: 180, marginBottom: 0 }}
                    maxLength={30}
                  />
                  <button
                    className="start-btn"
                    style={{ width: 70, padding: '8px 0' }}
                    onClick={addStudent}
                    disabled={!studentInput.trim() || students.some(s => s.name === studentInput.trim())}
                  >
                    등록
                  </button>
                </div>
                {/* 학생 목록 UI */}
                {students.length === 0 ? (
                  <div style={{ color: '#aaa', fontSize: 14, marginBottom: 18 }}>등록된 학생이 없습니다.</div>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, marginBottom: 18 }}>
                    {students.map((student, idx) => (
                      <li key={student.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, background: '#f7f8fc', borderRadius: 7, padding: '6px 10px' }}>
                        <span style={{ fontSize: 15, color: '#5b8cff', fontWeight: 600 }}>{student.name}</span>
                        <button
                          className="start-btn"
                          style={{ width: 50, fontSize: 13, padding: '5px 0', background: '#eee', color: '#c00' }}
                          onClick={() => deleteStudent(student.id)}
                        >
                          삭제
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {/* 학생별 음성파일 할당 UI */}
                {students.length > 0 && (
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>학생별 음성파일 할당</div>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                      {students.map((student, idx) => (
                        <li key={student.id} style={{ marginBottom: 16, background: '#f7f8fc', borderRadius: 7, padding: '10px 12px' }}>
                          <div style={{ fontWeight: 600, color: '#5b8cff', marginBottom: 6 }}>{student.name}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <input
                              type="file"
                              accept="audio/*"
                              multiple
                              onChange={e => handleFileUpload(student.id, e.target.files)}
                              style={{ fontSize: 13 }}
                            />
                          </div>
                          {/* 파일 목록 */}
                          {(studentsFiles[student.id]?.length ?? 0) === 0 ? (
                            <div style={{ color: '#aaa', fontSize: 13 }}>할당된 파일 없음</div>
                          ) : (
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                              {studentsFiles[student.id].map((file) => (
                                <li key={file.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                  <span style={{ fontSize: 13, color: '#444', minWidth: 120 }}>{file.fileName}</span>
                                  <button className="start-btn" style={{ width: 50, fontSize: 13, padding: '5px 0', background: '#5b8cff' }} onClick={() => downloadStudentFile(file)}>
                                    다운로드
                                  </button>
                                  <button className="start-btn" style={{ width: 50, fontSize: 13, padding: '5px 0', background: '#eee', color: '#c00' }} onClick={() => deleteStudentFile(student.id, file.id)}>
                                    삭제
                                  </button>
                                  <audio src={file.url} controls style={{ width: 180, marginLeft: 8, marginRight: 8 }} />
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <button
                  className="start-btn"
                  style={{ background: '#eee', color: '#888', marginTop: 10 }}
                  onClick={() => {
                    setIsAdminPage(false);
                    setIsAdminAuthed(false);
                    setAdminPwInput("");
                  }}
                >
                  로그아웃
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="center-area">
          <div className="login-card">
            <div className="profile-icon-bg">
              <span className="profile-icon">👤</span>
            </div>
            <div className="card-title">학습 시작하기</div>
            <div className="card-desc">이름을 입력하세요</div>
            {!entered ? (
              <>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="이름을 입력하세요"
                  className="name-input"
                />
                <button
                  onClick={() => setEntered(true)}
                  disabled={!name.trim()}
                  className="start-btn"
                >
                  <span style={{ fontSize: 18 }}>▶</span> 학습 시작
                </button>
              </>
            ) : (
              <div style={{ width: '100%' }}>
                <div className="welcome-msg">{name}님, 환영합니다!</div>
                <div style={{ margin: '32px 0 12px 0', fontWeight: 600, fontSize: 18 }}>할당된 연습 파일</div>
                {/* 본인에게 할당된 파일 목록 */}
                {studentId && myFiles.length > 0 ? (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, marginBottom: 16 }}>
                    {myFiles.map(file => (
                      <li key={file.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, background: '#f7f8fc', borderRadius: 7, padding: '6px 10px' }}>
                        <span style={{ fontSize: 14, color: '#5b8cff', minWidth: 120 }}>{file.fileName}</span>
                        <audio src={file.url} controls style={{ width: 180, marginLeft: 8, marginRight: 8 }} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div style={{ color: '#aaa', fontSize: 14, marginBottom: 16 }}>할당된 파일이 없습니다.</div>
                )}
                {/* AB 반복 컨트롤 */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 8 }}>
                  <button className="start-btn" style={{ width: 60, padding: '7px 0' }} onClick={setPointA}>
                    시작지점
                  </button>
                  <button className="start-btn" style={{ width: 60, padding: '7px 0' }} onClick={setPointB}>
                    끝지점
                  </button>
                  <button
                    className="start-btn"
                    style={{ width: 60, padding: '7px 0', background: isRepeating ? '#5b8cff' : undefined }}
                    onClick={() => setIsRepeating(r => !r)}
                    disabled={repeatA === null || repeatB === null || repeatA >= repeatB}
                  >
                    반복
                  </button>
                  <button className="start-btn" style={{ width: 60, padding: '7px 0', background: '#eee', color: '#888' }} onClick={clearRepeat}>
                    초기화
                  </button>
                </div>
                <div style={{ fontSize: 13, color: '#888', marginBottom: 8, textAlign: 'center' }}>
                  시작: {formatTime(repeatA)} / 끝: {formatTime(repeatB)} {isRepeating && repeatA !== null && repeatB !== null && repeatA < repeatB ? ' (구간 반복 중)' : ''}
                </div>
                {/* 북마크 저장 UI */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', marginBottom: 8 }}>
                  <input
                    type="text"
                    value={memoInput}
                    onChange={e => setMemoInput(e.target.value.slice(0, 30))}
                    placeholder="메모(최대 30자)"
                    style={{ width: 140, fontSize: 14, padding: '7px 8px', borderRadius: 6, border: '1px solid #ddd' }}
                    maxLength={30}
                    disabled={bookmarks.length >= maxBookmarks}
                  />
                  <button
                    className="start-btn"
                    style={{ width: 80, padding: '7px 0', background: bookmarks.length >= maxBookmarks ? '#eee' : undefined, color: bookmarks.length >= maxBookmarks ? '#aaa' : undefined }}
                    onClick={saveBookmark}
                    disabled={
                      repeatA === null ||
                      repeatB === null ||
                      repeatA >= repeatB ||
                      bookmarks.length >= maxBookmarks
                    }
                  >
                    북마크 저장
                  </button>
                  <span style={{ fontSize: 12, color: '#888' }}>{bookmarks.length}/{maxBookmarks}</span>
                </div>
                {/* 북마크 목록 UI */}
                {bookmarks.length > 0 && (
                  <div style={{ margin: '10px 0 18px 0' }}>
                    <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>구간 북마크 목록</div>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                      {bookmarks.map((bm, idx) => (
                        <li key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, background: '#f7f8fc', borderRadius: 7, padding: '6px 10px' }}>
                          <span style={{ fontSize: 13, color: '#5b8cff', minWidth: 90 }}>
                            {formatTime(bm.start)} ~ {formatTime(bm.end)}
                          </span>
                          <span style={{ fontSize: 12, color: '#888', minWidth: 110 }}>{bm.date}</span>
                          <span style={{ fontSize: 13, color: '#444', flex: 1, wordBreak: 'break-all' }}>{bm.memo}</span>
                          <button className="start-btn" style={{ width: 50, fontSize: 13, padding: '5px 0', background: '#5b8cff' }} onClick={() => applyBookmark(bm)}>
                            적용
                          </button>
                          <button className="start-btn" style={{ width: 50, fontSize: 13, padding: '5px 0', background: '#eee', color: '#c00' }} onClick={() => deleteBookmark(idx)}>
                            삭제
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 8 }}>
                  {[0.5, 0.7, 1.0, 1.2].map(rate => (
                    <button
                      key={rate}
                      onClick={() => handleRateChange(rate)}
                      className="start-btn"
                      style={{
                        width: 60,
                        background: playbackRate === rate ? 'linear-gradient(90deg, #7b5fff 0%, #5b8cff 100%)' : '#eee',
                        color: playbackRate === rate ? 'white' : '#444',
                        fontWeight: playbackRate === rate ? 700 : 500,
                        fontSize: 15,
                        border: 'none',
                        borderRadius: 7,
                        padding: '7px 0',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 13, color: '#888', marginBottom: 24 }}>
                  (속도 조절 버튼을 눌러 연습해보세요)
                </div>

                {/* 녹음 기능 */}
                <div style={{ margin: '32px 0 10px 0', fontWeight: 600, fontSize: 18 }}>내 목소리 녹음</div>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 16 }}>
                  {!isRecording ? (
                    <button className="start-btn" style={{ width: 120, background: '#ff5b5b' }} onClick={startRecording}>
                      <span role="img" aria-label="mic">🎤</span> 녹음 시작
                    </button>
                  ) : (
                    <button className="start-btn" style={{ width: 120, background: '#ff5b5b' }} onClick={stopRecording}>
                      <span role="img" aria-label="stop">⏹️</span> 녹음 정지
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 14, color: '#888', marginBottom: 10 }}>
                  {isRecording ? '녹음 중...' : '여러 개 녹음 저장 가능'}
                </div>
                <div>
                  {/* 내 로컬 녹음 목록 */}
                  {recordings.length === 0 ? (
                    <div style={{ color: '#aaa', fontSize: 14 }}>녹음된 파일이 없습니다.</div>
                  ) : (
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                      {recordings.map((rec, idx) => (
                        <li key={rec.url} style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <audio src={rec.url} controls style={{ width: 160 }} />
                          <span style={{ fontSize: 13, color: '#888' }}>{rec.date}</span>
                          <button onClick={() => downloadRecording(rec.url, rec.date)} style={{ background: '#eee', border: 'none', borderRadius: 5, padding: '4px 10px', color: '#5b8cff', cursor: 'pointer', fontSize: 13 }}>저장</button>
                          <button onClick={() => deleteRecording(rec.url)} style={{ background: '#eee', border: 'none', borderRadius: 5, padding: '4px 10px', color: '#c00', cursor: 'pointer', fontSize: 13 }}>삭제</button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* 내 서버(클라우드) 녹음 목록 */}
                  {studentId && myRecordings.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 14, color: '#5b8cff', fontWeight: 600, marginBottom: 4 }}>저장된 내 연습 결과</div>
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        {myRecordings.map(rec => (
                          <li key={rec.id} style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <audio src={rec.url} controls style={{ width: 160 }} />
                            <span style={{ fontSize: 13, color: '#888' }}>{rec.fileName} / {formatUploadedAt((rec as any).uploadedAt)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

// 학생별 연습 결과(녹음) 목록 컴포넌트
import React from 'react';
function StudentResultsList({ studentId }: { studentId: string }) {
  const [results, setResults] = React.useState<{ id: string; url: string; fileName: string }[]>([]);
  React.useEffect(() => {
    const unsub = onSnapshot(collection(db, `students/${studentId}/results`), (snap) => {
      setResults(snap.docs.map(doc => ({ id: doc.id, ...doc.data() as any })));
    });
    return unsub;
  }, [studentId]);
  if (results.length === 0) return <div style={{ color: '#aaa', fontSize: 13 }}>연습 결과 없음</div>;
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {results.map(rec => (
        <li key={rec.id} style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <audio src={rec.url} controls style={{ width: 160 }} />
          <span style={{ fontSize: 13, color: '#888' }}>{rec.fileName} / {formatUploadedAt((rec as any).uploadedAt)}</span>
        </li>
      ))}
    </ul>
  );
}
