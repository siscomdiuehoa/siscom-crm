import { escapeLike, foldedTextWhere, foldSearch } from './opportunities.search';

// Sales T-07: phần thuần của tìm cơ hội không dấu. Hành vi trên DB thật (gập dấu, đ/d, phạm vi): test/opportunities.int-spec.ts.
describe('opportunities.search (T-07)', () => {
  it('escapeLike: \\ % _ thành ký tự thường (thoát \\ TRƯỚC để không thoát hai lần)', () => {
    expect(escapeLike('hoa phat')).toBe('hoa phat');
    expect(escapeLike('50%')).toBe('50\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('c:\\x')).toBe('c:\\\\x');
    expect(escapeLike('\\%_')).toBe('\\\\\\%\\_');
  });

  it('foldedTextWhere: tiêu đề HOẶC tên dự án đã gập dấu chứa từ khoá đã thoát; không dùng cột thô, không mode insensitive', () => {
    expect(foldedTextWhere('hoa phat')).toEqual({ OR: [{ titleFold: { contains: 'hoa phat' } }, { projectNameFold: { contains: 'hoa phat' } }] });
    expect(foldedTextWhere('10%_x')).toEqual({ OR: [{ titleFold: { contains: '10\\%\\_x' } }, { projectNameFold: { contains: '10\\%\\_x' } }] });
    expect(JSON.stringify(foldedTextWhere('ab'))).not.toMatch(/"title"|"projectName"|insensitive/);
  });

  it('foldSearch: gửi từ khoá dưới dạng THAM SỐ (không ghép vào chuỗi SQL); null => chuỗi rỗng', async () => {
    const calls: Array<{ sql: readonly string[]; values: unknown[] }> = [];
    const tx = (t: string | null) => ({
      $queryRaw: (sql: TemplateStringsArray, ...values: unknown[]) => { calls.push({ sql: [...sql], values }); return Promise.resolve([{ t }]); },
    }) as never;
    const evil = "x'); DROP TABLE opportunity; --";
    expect(await foldSearch(tx('hoa phat'), evil)).toBe('hoa phat');
    expect(calls[0]?.values).toEqual([evil]);
    expect(calls[0]?.sql.join('$1')).toBe('SELECT public.f_vn_fold(btrim($1)) AS t');
    expect(await foldSearch(tx(null), 'ab')).toBe('');
  });
});
