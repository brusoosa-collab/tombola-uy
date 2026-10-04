import unittest
from datetime import date

import scrape


def section(period: str, numbers: list[int]) -> str:
    values = [99] * 20 + numbers
    markup = "".join(
        f'<span class="text_azul_3">{number:02d}</span>' for number in values
    )
    return f"cabezal_quinielas_{period}.png{markup}"


class ScrapeTests(unittest.TestCase):
    def test_parse_extracts_twenty_tombola_numbers_per_period(self):
        target = list(range(20))
        html = (
            "10 de Marzo de 2023"
            + section("vespertina", target)
            + section("nocturno", list(range(20, 40)))
        )

        draws = scrape.parse(date(2023, 3, 10), html)

        self.assertEqual([draw["period"] for draw in draws], ["vespertina", "nocturna"])
        self.assertEqual(draws[0]["numbers"], target)
        self.assertEqual(draws[1]["numbers"], list(range(20, 40)))
        self.assertTrue(all(len(draw["numbers"]) == 20 for draw in draws))

    def test_parse_rejects_page_for_a_different_date(self):
        html = "10 de Marzo de 2023" + section("vespertina", list(range(20)))

        self.assertEqual(scrape.parse(date(2023, 3, 11), html), [])

    def test_save_sort_order_is_chronological_within_the_day(self):
        vespertina = {"date": "2026-10-03", "period": "vespertina"}
        nocturna = {"date": "2026-10-03", "period": "nocturna"}

        self.assertLess(scrape.draw_sort_key(vespertina), scrape.draw_sort_key(nocturna))

    def test_day_list_skips_sunday_and_includes_saturday(self):
        days = scrape.day_list(date(2026, 10, 4), date(2026, 10, 11))

        self.assertEqual(
            days,
            [date(2026, 10, day) for day in (5, 6, 7, 8, 9, 10)],
        )

    def test_calendar_parser_finds_official_no_draw_dates(self):
        html = """
        <span>04/10/2026 16:47:37</span>
        <img src="LOTERIAS/2011/CALENDARIOS_PROGRAMAS/11.png">
        <img src="LOTERIAS/2011/CALENDARIOS_PROGRAMAS/logo_tombola_quiniela.jpg">
        <img src="LOTERIAS/2011/CALENDARIOS_PROGRAMAS/12.png">
        <img src=LOTERIAS/2011/CALENDARIOS_PROGRAMAS/logo_No_Hay_Sorteos.jpg>
        <img src="LOTERIAS/2011/CALENDARIOS_PROGRAMAS/13.png">
        <img src="LOTERIAS/2011/CALENDARIOS_PROGRAMAS/logo_tombola_quiniela.jpg">
        """

        month, no_draws = scrape.parse_calendar_no_draws(html)

        self.assertEqual(month, "2026-10")
        self.assertEqual(no_draws, ["2026-10-12"])


if __name__ == "__main__":
    unittest.main()
